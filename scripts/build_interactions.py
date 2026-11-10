#!/usr/bin/env python3
"""Build the normalized Phase 3 interaction-evidence layer.

This stage derives conservative, annotation-derived interactions only when an
effector's audited host target resolves to a single curated human protein.  It
also merges optional curator-supplied evidence from
``data/sources/interaction_evidence_seed.json``.  Evidence is intentionally a
separate table: any interaction may have zero or many supporting records.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from identifiers import (
    assign_registry_ids,
    interaction_evidence_key,
    interaction_key,
    is_entity_id,
    load_registry,
    validate_registry,
    write_registry,
)

ROOT = Path(__file__).resolve().parents[1]
DATASET_PATH = ROOT / "data" / "pathomap-dataset.json"
SAMPLE_PATH = ROOT / "data" / "sample-dataset.json"
DB_PATH = ROOT / "data" / "pathomap.db"
SQL_PATH = ROOT / "data" / "schema.sql"
INTERACTION_REGISTRY_PATH = ROOT / "data" / "sources" / "interaction_ids.json"
EVIDENCE_REGISTRY_PATH = ROOT / "data" / "sources" / "interaction_evidence_ids.json"
EVIDENCE_SEED_PATH = ROOT / "data" / "sources" / "interaction_evidence_seed.json"

SCHEMA_VERSION = "3.0"
EVIDENCE_CLASSES = {"experimental", "predicted", "annotation-derived", "hypothetical"}


class BuildError(RuntimeError):
    pass


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_manual_evidence() -> list[dict]:
    if not EVIDENCE_SEED_PATH.exists():
        return []
    payload = read_json(EVIDENCE_SEED_PATH)
    rows = payload.get("evidence", payload) if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise BuildError("interaction evidence seed must contain an evidence array")
    return rows


def build_records(dataset: dict) -> tuple[list[dict], list[dict], dict[str, str], dict[str, str]]:
    effectors = dataset.get("effectors", [])
    targets = {row.get("host_target_id"): row for row in dataset.get("host_targets", [])}
    proteins = {row.get("host_protein_id"): row for row in dataset.get("host_proteins", [])}
    interaction_registry = load_registry(INTERACTION_REGISTRY_PATH, "interactions")
    evidence_registry = load_registry(EVIDENCE_REGISTRY_PATH, "interaction_evidence")
    errors = validate_registry(interaction_registry, "interaction") + validate_registry(
        evidence_registry, "interaction_evidence"
    )
    if errors:
        raise BuildError("; ".join(errors))

    candidates: list[tuple[str, dict, dict]] = []
    for effector in effectors:
        target = targets.get(effector.get("host_target_id"))
        if not target or target.get("resolution_status") != "resolved_protein":
            continue
        protein = proteins.get(target.get("host_protein_id"))
        if not protein:
            raise BuildError(f"resolved target {target.get('entity_id')} lacks a host-protein row")
        effector_id, protein_id = effector.get("entity_id"), protein.get("entity_id")
        if not is_entity_id(effector_id, "effector") or not is_entity_id(protein_id, "host_protein"):
            raise BuildError("interaction candidates require valid stable effector and host-protein IDs")
        candidates.append((interaction_key(effector_id, protein_id), effector, protein))

    interaction_registry = assign_registry_ids(sorted(key for key, _e, _p in candidates), interaction_registry, "interaction")
    interactions: list[dict] = []
    evidence_inputs: list[dict] = []
    seen_pairs: set[str] = set()
    for key, effector, protein in sorted(candidates):
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        interaction_id = interaction_registry[key]
        interactions.append({
            "interaction_id": interaction_id,
            "effector_id": effector["entity_id"],
            "host_protein_id": protein["entity_id"],
            "mechanism": effector.get("mechanism") or None,
            "interaction_type": "effector_targets_host_protein",
            "provenance": "Derived from curated effector host_target and audited host-target resolution.",
        })
        evidence_inputs.append({
            "interaction_id": interaction_id,
            "evidence_class": "annotation-derived",
            "doi": None,
            "pmid": None,
            "database_accession": None,
            "provenance": "data/sources/effectors_seed.json; data/sources/host_target_audit.json",
            "note": "Relationship is derived from the original target annotation; it is not independent experimental evidence.",
        })

    by_pair = {interaction_key(row["effector_id"], row["host_protein_id"]): row["interaction_id"] for row in interactions}
    for index, row in enumerate(load_manual_evidence(), start=1):
        if not isinstance(row, dict):
            raise BuildError(f"manual evidence row {index} is not an object")
        pair = interaction_key(str(row.get("effector_id", "")), str(row.get("host_protein_id", "")))
        interaction_id = by_pair.get(pair)
        if not interaction_id:
            raise BuildError(f"manual evidence row {index} references an unresolved interaction pair")
        evidence_class = row.get("evidence_class")
        provenance = str(row.get("provenance") or "").strip()
        if evidence_class not in EVIDENCE_CLASSES or not provenance:
            raise BuildError(f"manual evidence row {index} needs a valid evidence_class and provenance")
        evidence_inputs.append({
            "interaction_id": interaction_id,
            "evidence_class": evidence_class,
            "doi": str(row.get("doi") or "").strip() or None,
            "pmid": str(row.get("pmid") or "").strip() or None,
            "database_accession": str(row.get("database_accession") or "").strip() or None,
            "provenance": provenance,
            "note": str(row.get("note") or "").strip() or None,
        })

    def evidence_key(row: dict) -> str:
        return interaction_evidence_key(
            row["interaction_id"], row["evidence_class"], row["doi"], row["pmid"],
            row["database_accession"], row["provenance"],
        )

    keys = [evidence_key(row) for row in evidence_inputs]
    evidence_registry = assign_registry_ids(sorted(set(keys)), evidence_registry, "interaction_evidence")
    evidence = [
        {"evidence_id": evidence_registry[evidence_key(row)], **row}
        for row in evidence_inputs
    ]
    return interactions, evidence, interaction_registry, evidence_registry


INTERACTIONS_DDL = """\
-- PathoMap v3.0 interaction evidence schema
CREATE TABLE interactions (
  interaction_id TEXT PRIMARY KEY,
  effector_id TEXT NOT NULL REFERENCES effectors(entity_id),
  host_protein_id TEXT NOT NULL REFERENCES host_proteins(entity_id),
  mechanism TEXT,
  interaction_type TEXT NOT NULL,
  provenance TEXT NOT NULL,
  UNIQUE (effector_id, host_protein_id)
);
CREATE INDEX idx_interactions_effector_id ON interactions(effector_id);
CREATE INDEX idx_interactions_host_protein_id ON interactions(host_protein_id);
CREATE TABLE interaction_evidence (
  evidence_id TEXT PRIMARY KEY,
  interaction_id TEXT NOT NULL REFERENCES interactions(interaction_id) ON DELETE CASCADE,
  evidence_class TEXT NOT NULL CHECK (evidence_class IN ('experimental', 'predicted', 'annotation-derived', 'hypothetical')),
  doi TEXT,
  pmid TEXT,
  database_accession TEXT,
  provenance TEXT NOT NULL,
  note TEXT
);
CREATE INDEX idx_interaction_evidence_interaction_id ON interaction_evidence(interaction_id);
CREATE INDEX idx_interaction_evidence_class ON interaction_evidence(evidence_class);
"""


def write_sqlite(interactions: list[dict], evidence: list[dict]) -> None:
    with sqlite3.connect(DB_PATH) as con:
        con.execute("PRAGMA foreign_keys = ON")
        con.execute("DROP TABLE IF EXISTS interaction_evidence")
        con.execute("DROP TABLE IF EXISTS interactions")
        con.executescript(INTERACTIONS_DDL)
        con.executemany(
            "INSERT INTO interactions VALUES (:interaction_id,:effector_id,:host_protein_id,:mechanism,:interaction_type,:provenance)",
            interactions,
        )
        con.executemany(
            "INSERT INTO interaction_evidence VALUES (:evidence_id,:interaction_id,:evidence_class,:doi,:pmid,:database_accession,:provenance,:note)",
            evidence,
        )
        issues = con.execute("PRAGMA foreign_key_check").fetchall()
        if issues:
            raise BuildError(f"SQLite foreign-key violations: {issues}")


def update_sql_file() -> None:
    existing = SQL_PATH.read_text(encoding="utf-8")
    marker = "-- PathoMap v3.0 interaction evidence schema"
    if marker in existing:
        existing = existing.split(marker, 1)[0].rstrip() + "\n\n"
    SQL_PATH.write_text(existing + INTERACTIONS_DDL, encoding="utf-8")


def update_dataset(path: Path, interactions: list[dict], evidence: list[dict]) -> None:
    payload = read_json(path)
    meta = payload.setdefault("meta", {})
    meta["schema_version"] = SCHEMA_VERSION
    meta.setdefault("identifiers", {}).setdefault("types", {}).update({"interaction": "INT", "interaction_evidence": "EVD"})
    meta.setdefault("tables", {}).update({"interactions": len(interactions), "interaction_evidence": len(evidence)})
    payload["interactions"] = interactions
    payload["interaction_evidence"] = evidence
    write_json(path, payload)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate/build in memory without writing")
    args = parser.parse_args()
    dataset = read_json(DATASET_PATH)
    interactions, evidence, interaction_registry, evidence_registry = build_records(dataset)
    if not args.check:
        update_dataset(DATASET_PATH, interactions, evidence)
        sample = read_json(SAMPLE_PATH)
        sample_effector_ids = {row["entity_id"] for row in sample.get("effectors", [])}
        sample_interactions = [row for row in interactions if row["effector_id"] in sample_effector_ids]
        sample_ids = {row["interaction_id"] for row in sample_interactions}
        update_dataset(SAMPLE_PATH, sample_interactions, [row for row in evidence if row["interaction_id"] in sample_ids])
        write_sqlite(interactions, evidence)
        update_sql_file()
        write_registry(INTERACTION_REGISTRY_PATH, "interactions", interaction_registry, "Stable interaction IDs keyed by '<effector_id>|<host_protein_id>'.")
        write_registry(EVIDENCE_REGISTRY_PATH, "interaction_evidence", evidence_registry, "Stable interaction-evidence IDs keyed by interaction, class, identifiers and provenance.")
    print(f"interactions: {len(interactions)}")
    print(f"interaction evidence: {len(evidence)}")
    print("validation: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

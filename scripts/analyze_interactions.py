#!/usr/bin/env python3
"""Analyze normalized PathoMap interaction and evidence records.

The analysis is intentionally read-only with respect to curated source tables.
It validates and deduplicates relationships, computes network and evidence
statistics, and writes a derived JSON artifact suitable for a UI or notebook.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
from identifiers import is_entity_id

ROOT = Path(__file__).resolve().parents[1]
DATASET_PATH = ROOT / "data" / "pathomap-dataset.json"
OUTPUT_PATH = ROOT / "data" / "derived" / "interaction_analysis.json"
ANALYSIS_VERSION = "1.0"
EVIDENCE_CLASSES = {"experimental", "predicted", "annotation-derived", "hypothetical"}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def timestamp() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def issue(code: str, detail: str, row_id: str | None = None) -> dict:
    result = {"code": code, "detail": detail}
    if row_id:
        result["row_id"] = row_id
    return result


def analyze(dataset: dict, source_bytes: bytes) -> dict:
    effectors = {row.get("entity_id"): row for row in dataset.get("effectors", [])}
    proteins = {row.get("entity_id"): row for row in dataset.get("host_proteins", [])}
    pathogens = {row.get("pathogen_id"): row for row in dataset.get("pathogens", [])}

    raw_interactions = dataset.get("interactions", [])
    validation_issues: list[dict] = []
    valid_rows: list[dict] = []
    seen_ids: set[str] = set()
    for row in raw_interactions:
        row_id = row.get("interaction_id") if isinstance(row, dict) else None
        if not isinstance(row, dict):
            validation_issues.append(issue("invalid_row", "Interaction row is not an object."))
            continue
        if not is_entity_id(row_id, "interaction"):
            validation_issues.append(issue("invalid_interaction_id", "Interaction ID is not a PM-INT identifier.", str(row_id)))
            continue
        if row_id in seen_ids:
            validation_issues.append(issue("duplicate_interaction_id", "Duplicate interaction ID discarded.", row_id))
            continue
        seen_ids.add(row_id)
        effector_id, protein_id = row.get("effector_id"), row.get("host_protein_id")
        if effector_id not in effectors or protein_id not in proteins:
            validation_issues.append(issue("broken_relationship", "Effector or host-protein ID does not resolve.", row_id))
            continue
        valid_rows.append(row)

    # A pair is one directed relationship. If duplicate relationship rows occur,
    # retain the lexicographically earliest stable ID for deterministic output.
    by_pair: dict[tuple[str, str], dict] = {}
    for row in sorted(valid_rows, key=lambda item: item["interaction_id"]):
        pair = (row["effector_id"], row["host_protein_id"])
        if pair in by_pair:
            validation_issues.append(issue("duplicate_relationship", "Duplicate effector-to-host relationship discarded.", row["interaction_id"]))
        else:
            by_pair[pair] = row
    interactions = list(by_pair.values())
    valid_interaction_ids = {row["interaction_id"] for row in interactions}

    raw_evidence = dataset.get("interaction_evidence", [])
    evidence_issues: list[dict] = []
    evidence: list[dict] = []
    seen_evidence_ids: set[str] = set()
    for row in raw_evidence:
        row_id = row.get("evidence_id") if isinstance(row, dict) else None
        if not isinstance(row, dict):
            evidence_issues.append(issue("invalid_row", "Evidence row is not an object."))
            continue
        if not is_entity_id(row_id, "interaction_evidence") or row_id in seen_evidence_ids:
            evidence_issues.append(issue("invalid_or_duplicate_evidence_id", "Evidence ID is invalid or duplicated.", str(row_id)))
            continue
        seen_evidence_ids.add(row_id)
        if row.get("interaction_id") not in valid_interaction_ids:
            evidence_issues.append(issue("orphan_evidence", "Evidence does not reference a retained interaction.", row_id))
            continue
        if row.get("evidence_class") not in EVIDENCE_CLASSES:
            evidence_issues.append(issue("invalid_evidence_class", "Evidence class is unsupported.", row_id))
            continue
        evidence.append(row)

    evidence_by_interaction: dict[str, list[dict]] = defaultdict(list)
    for row in evidence:
        evidence_by_interaction[row["interaction_id"]].append(row)

    pathogen_to_interactions: Counter[str] = Counter()
    host_to_pathogens: dict[str, set[str]] = defaultdict(set)
    for row in interactions:
        effector = effectors[row["effector_id"]]
        pathogen = pathogens.get(effector.get("pathogen_id"), {})
        pathogen_id = pathogen.get("entity_id")
        if pathogen_id:
            pathogen_to_interactions[pathogen_id] += 1
            host_to_pathogens[row["host_protein_id"]].add(pathogen_id)

    multi_pathogen_hosts = []
    for host_id, pathogen_ids in host_to_pathogens.items():
        if len(pathogen_ids) > 1:
            protein = proteins[host_id]
            multi_pathogen_hosts.append({
                "host_protein_id": host_id,
                "protein_name": protein.get("protein_name"),
                "gene_name": protein.get("gene_name"),
                "pathogen_ids": sorted(pathogen_ids),
                "pathogen_count": len(pathogen_ids),
                "interaction_count": sum(1 for row in interactions if row["host_protein_id"] == host_id),
            })
    multi_pathogen_hosts.sort(key=lambda row: (-row["pathogen_count"], -row["interaction_count"], row["host_protein_id"]))

    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    for row in interactions:
        effector = effectors[row["effector_id"]]
        protein = proteins[row["host_protein_id"]]
        pathogen = pathogens.get(effector.get("pathogen_id"), {})
        if pathogen.get("entity_id"):
            nodes[pathogen["entity_id"]] = {"id": pathogen["entity_id"], "type": "pathogen", "label": pathogen.get("name")}
        nodes[row["effector_id"]] = {"id": row["effector_id"], "type": "effector", "label": effector.get("effector_name"), "pathogen_id": pathogen.get("entity_id")}
        nodes[row["host_protein_id"]] = {"id": row["host_protein_id"], "type": "host_protein", "label": protein.get("protein_name"), "gene_name": protein.get("gene_name")}
        evidence_rows = sorted(evidence_by_interaction.get(row["interaction_id"], []), key=lambda item: item["evidence_id"])
        edges.append({
            "id": row["interaction_id"],
            "source": row["effector_id"],
            "target": row["host_protein_id"],
            "type": row.get("interaction_type"),
            "mechanism": row.get("mechanism"),
            "evidence_count": len(evidence_rows),
            "evidence_classes": sorted({item["evidence_class"] for item in evidence_rows}),
            "evidence_ids": [item["evidence_id"] for item in evidence_rows],
        })

    evidence_counts = Counter(row["evidence_class"] for row in evidence)
    interactions_with_evidence = sum(1 for row in interactions if evidence_by_interaction.get(row["interaction_id"]))
    return {
        "meta": {
            "analysis": "interaction_analysis",
            "analysis_version": ANALYSIS_VERSION,
            "generated_at": timestamp(),
            "source_dataset_schema_version": dataset.get("meta", {}).get("schema_version"),
            "source_dataset_sha256": hashlib.sha256(source_bytes).hexdigest(),
            "input_tables": ["pathogens", "effectors", "host_proteins", "interactions", "interaction_evidence"],
        },
        "validation": {
            "raw_interaction_count": len(raw_interactions),
            "retained_interaction_count": len(interactions),
            "discarded_interaction_count": len(raw_interactions) - len(interactions),
            "interaction_issues": validation_issues,
            "raw_evidence_count": len(raw_evidence),
            "retained_evidence_count": len(evidence),
            "discarded_evidence_count": len(raw_evidence) - len(evidence),
            "evidence_issues": evidence_issues,
        },
        "statistics": {
            "interaction_count": len(interactions),
            "unique_effector_count": len({row["effector_id"] for row in interactions}),
            "unique_host_protein_count": len({row["host_protein_id"] for row in interactions}),
            "unique_pathogen_count": len(pathogen_to_interactions),
            "host_proteins_targeted_by_multiple_pathogens_count": len(multi_pathogen_hosts),
            "evidence_count": len(evidence),
            "interactions_with_evidence_count": interactions_with_evidence,
            "interactions_without_evidence_count": len(interactions) - interactions_with_evidence,
            "mean_evidence_per_interaction": round(len(evidence) / len(interactions), 3) if interactions else 0,
            "evidence_by_class": dict(sorted(evidence_counts.items())),
            "interactions_by_pathogen": dict(sorted(pathogen_to_interactions.items())),
        },
        "host_proteins_targeted_by_multiple_pathogens": multi_pathogen_hosts,
        "network": {"nodes": sorted(nodes.values(), key=lambda item: item["id"]), "edges": sorted(edges, key=lambda item: item["id"])},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate and calculate without writing the JSON artifact")
    args = parser.parse_args()
    source_bytes = DATASET_PATH.read_bytes()
    result = analyze(json.loads(source_bytes), source_bytes)
    if not args.check:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    stats = result["statistics"]
    print(f"interactions: {stats['interaction_count']}")
    print(f"unique effectors: {stats['unique_effector_count']}")
    print(f"unique host proteins: {stats['unique_host_protein_count']}")
    print(f"multi-pathogen host proteins: {stats['host_proteins_targeted_by_multiple_pathogens_count']}")
    print(f"evidence records: {stats['evidence_count']}")
    print("validation: ok" if not result["validation"]["interaction_issues"] and not result["validation"]["evidence_issues"] else "validation: warnings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

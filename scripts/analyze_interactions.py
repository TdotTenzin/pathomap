#!/usr/bin/env python3
"""Analyze normalized PathoMap interaction and evidence records.

The analysis is intentionally read-only with respect to curated source tables.
It validates and deduplicates relationships, computes network and evidence
statistics, and writes a derived JSON artifact suitable for a UI or notebook.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
import sys
from collections import Counter, defaultdict
from contextlib import nullcontext
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
from build_common import no_writes, utc_now, write_json
from identifiers import interaction_evidence_key, is_entity_id

ROOT = Path(__file__).resolve().parents[1]
DATASET_PATH = ROOT / "data" / "pathomap-dataset.json"
OUTPUT_PATH = ROOT / "data" / "derived" / "interaction_analysis.json"
SAMPLE_DATASET_PATH = ROOT / "data" / "sample-dataset.json"
SAMPLE_OUTPUT_PATH = ROOT / "data" / "derived" / "interaction_analysis_sample.json"
ANALYSIS_VERSION = "1.2"
OUTPUT_SCHEMA_VERSION = "1.2"
EVIDENCE_CLASSES = {"experimental", "predicted", "annotation-derived", "hypothetical"}
EVIDENCE_PRIORITY = {
    "experimental": 4,
    "predicted": 3,
    "annotation-derived": 2,
    "hypothetical": 1,
}
PARAMETERS = {
    "deduplicate_relationships": True,
    "duplicate_relationship_policy": "retain_lexicographically_earliest_interaction_id",
    "evidence_identity": "interaction_id|evidence_class|doi|pmid|database_accession|provenance",
    "host_target_scope": "curated_host_target_ids",
    "pathogen_classification": "gram_stain_or_name_heuristic",
}
INPUT_TABLES = ["pathogens", "effectors", "host_proteins", "host_targets", "interactions", "interaction_evidence"]


def issue(code: str, detail: str, row_id: str | None = None) -> dict:
    result = {"code": code, "detail": detail}
    if row_id:
        result["row_id"] = row_id
    return result


def issue_sort_key(item: dict) -> tuple[str, str, str]:
    return (str(item.get("row_id") or ""), item["code"], item["detail"])


def count_issue_codes(issues: list[dict]) -> dict[str, int]:
    return dict(sorted(Counter(item["code"] for item in issues).items()))


def table_rows(dataset: dict, name: str, table_issues: list[dict]) -> list:
    if name not in dataset:
        table_issues.append(issue("missing_table", f"Required table '{name}' is missing."))
        return []
    rows = dataset[name]
    if not isinstance(rows, list):
        table_issues.append(issue("invalid_table", f"Table '{name}' is not an array."))
        return []
    return rows


def source_path_label(path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def strongest_evidence_class(classes: list[str]) -> str | None:
    if not classes:
        return None
    return max(classes, key=lambda item: EVIDENCE_PRIORITY.get(item, 0))


def classify_pathogen(row: dict) -> str:
    gram_stain = row.get("gram_stain")
    if gram_stain in ("Gram-positive", "Gram-negative"):
        return str(gram_stain)

    text = " ".join(str(row.get(field) or "") for field in ("name", "phylum", "class_name")).lower()
    if re.search(r"viricota|viridae|virus", text):
        return "Virus"
    if re.search(
        r"ascomycota|basidiomycota|mucoromycota|chytridiomycota|microsporid|fungus|fungi",
        text,
    ):
        return "Fungus"
    if re.search(
        r"apicomplexa|nematoda|platyhelminthes|kinetoplastida|amoebozoa|parasite|"
        r"plasmodium|toxoplasma|trypanosoma|leishmania|giardia|entamoeba",
        text,
    ):
        return "Parasite"
    return "Unclassified"


def evidence_summary(row: dict) -> dict:
    return {
        "evidence_id": row.get("evidence_id"),
        "evidence_class": row.get("evidence_class"),
        "doi": row.get("doi"),
        "pmid": row.get("pmid"),
        "database_accession": row.get("database_accession"),
        "provenance": row.get("provenance"),
        "note": row.get("note"),
    }


def collect_unresolved_targets(dataset: dict, pathogens: dict, targets: dict, retained_effector_ids: set[str]) -> dict:
    groups: dict[str, dict] = {}
    for effector in table_rows(dataset, "effectors", []):
        if not isinstance(effector, dict):
            continue
        effector_id = effector.get("entity_id")
        if not is_entity_id(effector_id, "effector"):
            continue
        target_id = effector.get("host_target_id")
        target = targets.get(target_id) if target_id is not None else None
        status = None
        reason = None
        if target_id is None:
            status = "missing_host_target_id"
            reason = "Effector has no curated host_target_id."
        elif target is None:
            status = "missing_host_target_record"
            reason = "Host target ID does not resolve to a host_targets row."
        else:
            status = str(target.get("resolution_status") or "unresolved")
            if status != "resolved_protein":
                reason = f"Host target is classified as '{status}', not resolved_protein."
            elif effector_id not in retained_effector_ids:
                reason = "Host target is resolved but the effector has no retained interaction."
        if reason is None:
            continue

        key = str(target_id) if target_id is not None else f"missing:{effector_id}"
        group = groups.setdefault(key, {
            "host_target_id": target.get("entity_id") if target else target_id,
            "target_name": target.get("name") if target else None,
            "host_target_class": target.get("host_target_class") if target else None,
            "resolution_status": status,
            "reason": reason,
            "effector_ids": set(),
            "effector_names": set(),
            "pathogen_ids": set(),
        })
        group["effector_ids"].add(effector_id)
        if effector.get("effector_name"):
            group["effector_names"].add(str(effector["effector_name"]))
        pathogen = pathogens.get(effector.get("pathogen_id"))
        if isinstance(pathogen, dict) and pathogen.get("entity_id"):
            group["pathogen_ids"].add(pathogen["entity_id"])

    rows = []
    for group in groups.values():
        rows.append({
            "host_target_id": group["host_target_id"],
            "target_name": group["target_name"],
            "host_target_class": group["host_target_class"],
            "resolution_status": group["resolution_status"],
            "reason": group["reason"],
            "effector_ids": sorted(group["effector_ids"]),
            "effector_names": sorted(group["effector_names"]),
            "effector_count": len(group["effector_ids"]),
            "pathogen_ids": sorted(group["pathogen_ids"]),
        })
    rows.sort(key=lambda item: (-item["effector_count"], item["resolution_status"], str(item["host_target_id"])))

    by_status: dict[str, dict[str, int]] = {}
    for row in rows:
        entry = by_status.setdefault(row["resolution_status"], {"target_count": 0, "effector_count": 0})
        entry["target_count"] += 1
        entry["effector_count"] += row["effector_count"]

    return {
        "target_count": len(rows),
        "effector_count": sum(row["effector_count"] for row in rows),
        "by_resolution_status": dict(sorted(by_status.items())),
        "targets": rows,
    }


def retained_source_records(dataset: dict) -> dict:
    """Recompute retained interactions and evidence directly from source tables."""
    def rows(name: str) -> list:
        value = dataset.get(name, [])
        return value if isinstance(value, list) else []

    effectors = {
        row.get("entity_id")
        for row in rows("effectors")
        if isinstance(row, dict) and is_entity_id(row.get("entity_id"), "effector")
    }
    proteins = {
        row.get("entity_id")
        for row in rows("host_proteins")
        if isinstance(row, dict) and is_entity_id(row.get("entity_id"), "host_protein")
    }

    seen_interaction_ids: set[str] = set()
    valid_interactions: list[dict] = []
    for row in rows("interactions"):
        if not isinstance(row, dict):
            continue
        row_id = row.get("interaction_id")
        if not is_entity_id(row_id, "interaction") or row_id in seen_interaction_ids:
            continue
        seen_interaction_ids.add(row_id)
        effector_id, protein_id = row.get("effector_id"), row.get("host_protein_id")
        if effector_id not in effectors or protein_id not in proteins:
            continue
        valid_interactions.append(row)

    by_pair: dict[tuple[str, str], dict] = {}
    for row in sorted(valid_interactions, key=lambda item: item["interaction_id"]):
        by_pair.setdefault((row["effector_id"], row["host_protein_id"]), row)
    interactions = sorted(by_pair.values(), key=lambda item: item["interaction_id"])
    valid_interaction_ids = {row["interaction_id"] for row in interactions}

    seen_evidence_ids: set[str] = set()
    seen_evidence_keys: set[str] = set()
    evidence: list[dict] = []
    for row in rows("interaction_evidence"):
        if not isinstance(row, dict):
            continue
        row_id = row.get("evidence_id")
        if not is_entity_id(row_id, "interaction_evidence") or row_id in seen_evidence_ids:
            continue
        seen_evidence_ids.add(row_id)
        interaction_id = row.get("interaction_id")
        if interaction_id not in valid_interaction_ids:
            continue
        if row.get("evidence_class") not in EVIDENCE_CLASSES:
            continue
        provenance = str(row.get("provenance") or "").strip()
        if not provenance:
            continue
        key = interaction_evidence_key(
            interaction_id,
            row.get("evidence_class"),
            row.get("doi"),
            row.get("pmid"),
            row.get("database_accession"),
            provenance,
        )
        if key in seen_evidence_keys:
            continue
        seen_evidence_keys.add(key)
        evidence.append(row)

    evidence.sort(key=lambda item: item["evidence_id"])
    evidence_by_interaction: dict[str, list[dict]] = defaultdict(list)
    for row in evidence:
        evidence_by_interaction[row["interaction_id"]].append(row)

    return {
        "interactions": interactions,
        "evidence": evidence,
        "evidence_by_interaction": evidence_by_interaction,
    }


def validate_result(result: dict, dataset: dict | None = None) -> list[dict]:
    issues: list[dict] = []
    nodes = result["network"]["nodes"]
    edges = result["network"]["edges"]
    node_ids = {node["id"] for node in nodes}
    if len(node_ids) != len(nodes):
        issues.append(issue("duplicate_node_id", "Network contains duplicate node IDs."))
    edge_ids: set[str] = set()
    for edge in edges:
        if edge["id"] in edge_ids:
            issues.append(issue("duplicate_edge_id", "Network contains duplicate edge IDs.", edge["id"]))
        edge_ids.add(edge["id"])
        if edge["source"] not in node_ids or edge["target"] not in node_ids:
            issues.append(issue("dangling_edge", "Edge references a missing network node.", edge["id"]))
    expected_edges = result["statistics"]["interaction_count"]
    if len(edges) != expected_edges:
        issues.append(issue("edge_count_mismatch", f"Expected {expected_edges} edges, found {len(edges)}."))
    if len(edge_ids) != result["validation"]["retained_interaction_count"]:
        issues.append(issue("retained_edge_mismatch", "Retained interaction count does not match unique network edges."))

    if not isinstance(dataset, dict):
        return issues

    source = retained_source_records(dataset)
    source_interaction_ids = {row["interaction_id"] for row in source["interactions"]}
    stats = result.get("statistics", {})
    validation = result.get("validation", {})
    raw_interactions = dataset.get("interactions")
    raw_evidence = dataset.get("interaction_evidence")
    raw_interactions = raw_interactions if isinstance(raw_interactions, list) else []
    raw_evidence = raw_evidence if isinstance(raw_evidence, list) else []

    if validation.get("raw_interaction_count") != len(raw_interactions):
        issues.append(issue("source_interaction_count_mismatch", "Raw interaction count does not match source table."))
    if validation.get("retained_interaction_count") != len(source["interactions"]):
        issues.append(issue("source_retained_count_mismatch", "Retained interaction count does not match source table."))
    if stats.get("interaction_count") != len(source["interactions"]):
        issues.append(issue("source_statistics_mismatch", "Statistics interaction count does not match source table."))
    if edge_ids != source_interaction_ids:
        issues.append(issue("edge_source_mismatch", "Network edge IDs do not match retained source interactions."))
    if validation.get("raw_evidence_count") != len(raw_evidence):
        issues.append(issue("source_evidence_count_mismatch", "Raw evidence count does not match source table."))
    if validation.get("retained_evidence_count") != len(source["evidence"]):
        issues.append(issue("retained_evidence_mismatch", "Retained evidence count does not match source table."))

    for edge in edges:
        expected_records = source["evidence_by_interaction"].get(edge.get("id"), [])
        edge_id = edge.get("id")
        if edge.get("evidence_count") != len(expected_records):
            issues.append(issue("edge_evidence_count_mismatch", "Edge evidence count does not match source evidence.", edge_id))
        if set(edge.get("evidence_classes") or []) != {row["evidence_class"] for row in expected_records}:
            issues.append(issue("edge_evidence_class_mismatch", "Edge evidence classes do not match source evidence.", edge_id))
        expected_record_ids = {row["evidence_id"] for row in expected_records}
        record_ids = {row.get("evidence_id") for row in edge.get("evidence_records", [])}
        if record_ids != expected_record_ids:
            issues.append(issue("edge_evidence_id_mismatch", "Edge evidence IDs do not match source evidence.", edge_id))

    unresolved = result.get("unresolved_targets", {})
    if stats.get("unresolved_target_count") != len(unresolved.get("targets", [])):
        issues.append(issue("unresolved_target_count_mismatch", "Unresolved target count does not match target rows."))
    if stats.get("unresolved_effector_count") != unresolved.get("effector_count"):
        issues.append(issue("unresolved_effector_count_mismatch", "Unresolved effector count does not match target rows."))

    return issues


def analyze(
    dataset: dict,
    source_bytes: bytes,
    *,
    dataset_path: Path | None = None,
    parameters: dict | None = None,
) -> dict:
    if not isinstance(dataset, dict):
        raise ValueError("dataset must be a JSON object")

    table_issues: list[dict] = []
    raw_interactions = table_rows(dataset, "interactions", table_issues)
    raw_evidence = table_rows(dataset, "interaction_evidence", table_issues)

    effectors = {
        row.get("entity_id"): row
        for row in table_rows(dataset, "effectors", table_issues)
        if isinstance(row, dict)
    }
    proteins = {
        row.get("entity_id"): row
        for row in table_rows(dataset, "host_proteins", table_issues)
        if isinstance(row, dict)
    }
    pathogen_rows = table_rows(dataset, "pathogens", table_issues)
    pathogens = {
        row.get("pathogen_id"): row
        for row in pathogen_rows
        if isinstance(row, dict)
    }
    pathogens_by_entity = {
        row.get("entity_id"): row
        for row in pathogen_rows
        if isinstance(row, dict) and row.get("entity_id")
    }
    targets = {
        row.get("host_target_id"): row
        for row in table_rows(dataset, "host_targets", table_issues)
        if isinstance(row, dict)
    }

    validation_issues: list[dict] = list(table_issues)
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
        if not is_entity_id(effector_id, "effector"):
            validation_issues.append(issue("invalid_effector_id", "Effector ID is not a PM-EFF identifier.", row_id))
            continue
        if not is_entity_id(protein_id, "host_protein"):
            validation_issues.append(issue("invalid_host_protein_id", "Host-protein ID is not a PM-HST identifier.", row_id))
            continue
        if effector_id not in effectors or protein_id not in proteins:
            validation_issues.append(issue("broken_relationship", "Effector or host-protein ID does not resolve.", row_id))
            continue

        effector = effectors[effector_id]
        pathogen = pathogens.get(effector.get("pathogen_id"))
        if not isinstance(pathogen, dict) or not pathogen.get("entity_id"):
            validation_issues.append(issue("broken_pathogen_link", "Effector pathogen_id does not resolve to a pathogen.", row_id))
        if blank(row.get("interaction_type")):
            validation_issues.append(issue("missing_interaction_type", "Interaction has no relationship predicate.", row_id))
        if blank(row.get("provenance")):
            validation_issues.append(issue("missing_interaction_provenance", "Interaction has no provenance.", row_id))
        valid_rows.append(row)

    by_pair: dict[tuple[str, str], dict] = {}
    for row in sorted(valid_rows, key=lambda item: item["interaction_id"]):
        pair = (row["effector_id"], row["host_protein_id"])
        if pair in by_pair:
            validation_issues.append(issue("duplicate_relationship", "Duplicate effector-to-host relationship discarded.", row["interaction_id"]))
            retained = by_pair[pair]
            conflicting = any(
                retained.get(field) != row.get(field)
                for field in ("mechanism", "interaction_type", "provenance")
            )
            if conflicting:
                validation_issues.append(issue("conflicting_relationship", "Duplicate relationship has conflicting details; earliest ID retained.", row["interaction_id"]))
        else:
            by_pair[pair] = row
    interactions = sorted(by_pair.values(), key=lambda item: item["interaction_id"])
    valid_interaction_ids = {row["interaction_id"] for row in interactions}

    evidence_issues: list[dict] = []
    evidence: list[dict] = []
    seen_evidence_ids: set[str] = set()
    seen_evidence_keys: set[str] = set()
    for row in raw_evidence:
        row_id = row.get("evidence_id") if isinstance(row, dict) else None
        if not isinstance(row, dict):
            evidence_issues.append(issue("invalid_row", "Evidence row is not an object."))
            continue
        if not is_entity_id(row_id, "interaction_evidence"):
            evidence_issues.append(issue("invalid_evidence_id", "Evidence ID is not a PM-EVD identifier.", str(row_id)))
            continue
        if row_id in seen_evidence_ids:
            evidence_issues.append(issue("duplicate_evidence_id", "Duplicate evidence ID discarded.", row_id))
            continue
        seen_evidence_ids.add(row_id)

        interaction_id = row.get("interaction_id")
        if not is_entity_id(interaction_id, "interaction"):
            evidence_issues.append(issue("invalid_evidence_interaction_id", "Evidence interaction ID is not a PM-INT identifier.", row_id))
            continue
        if interaction_id not in valid_interaction_ids:
            evidence_issues.append(issue("orphan_evidence", "Evidence does not reference a retained interaction.", row_id))
            continue
        evidence_class = row.get("evidence_class")
        if evidence_class not in EVIDENCE_CLASSES:
            evidence_issues.append(issue("invalid_evidence_class", "Evidence class is unsupported.", row_id))
            continue
        provenance = str(row.get("provenance") or "").strip()
        if not provenance:
            evidence_issues.append(issue("missing_evidence_provenance", "Evidence has no provenance.", row_id))
            continue

        key = interaction_evidence_key(
            interaction_id,
            evidence_class,
            row.get("doi"),
            row.get("pmid"),
            row.get("database_accession"),
            provenance,
        )
        if key in seen_evidence_keys:
            evidence_issues.append(issue("duplicate_evidence", "Semantically duplicate evidence discarded.", row_id))
            continue
        seen_evidence_keys.add(key)
        evidence.append(row)

    evidence.sort(key=lambda item: item["evidence_id"])
    evidence_by_interaction: dict[str, list[dict]] = defaultdict(list)
    for row in evidence:
        evidence_by_interaction[row["interaction_id"]].append(row)
    for rows in evidence_by_interaction.values():
        rows.sort(key=lambda item: item["evidence_id"])

    for row in interactions:
        if not evidence_by_interaction.get(row["interaction_id"]):
            evidence_issues.append(issue("interaction_without_evidence", "Interaction has no supporting evidence record.", row["interaction_id"]))

    pathogen_to_interactions: Counter[str] = Counter()
    pathogen_to_effectors: dict[str, set[str]] = defaultdict(set)
    host_to_pathogens: dict[str, set[str]] = defaultdict(set)
    host_to_effectors: dict[str, set[str]] = defaultdict(set)
    host_to_interactions: Counter[str] = Counter()
    retained_effector_ids: set[str] = set()
    unique_target_ids: set[str] = set()
    for row in interactions:
        effector = effectors[row["effector_id"]]
        protein = proteins[row["host_protein_id"]]
        retained_effector_ids.add(row["effector_id"])
        if effector.get("host_target_id") is not None:
            unique_target_ids.add(str(effector["host_target_id"]))
        pathogen = pathogens.get(effector.get("pathogen_id"))
        pathogen_id = pathogen.get("entity_id") if isinstance(pathogen, dict) else None
        if pathogen_id:
            pathogen_to_interactions[pathogen_id] += 1
            pathogen_to_effectors[pathogen_id].add(row["effector_id"])
            host_to_pathogens[row["host_protein_id"]].add(pathogen_id)
        host_to_effectors[row["host_protein_id"]].add(row["effector_id"])
        host_to_interactions[row["host_protein_id"]] += 1

    multi_pathogen_hosts = []
    for host_id, pathogen_ids in host_to_pathogens.items():
        if len(pathogen_ids) <= 1:
            continue
        protein = proteins[host_id]
        pathogen_names = sorted(
            str(pathogens_by_entity[pathogen_id]["name"])
            for pathogen_id in pathogen_ids
            if pathogens_by_entity.get(pathogen_id, {}).get("name")
        )
        multi_pathogen_hosts.append({
            "host_protein_id": host_id,
            "protein_name": protein.get("protein_name"),
            "gene_name": protein.get("gene_name"),
            "uniprot_id": protein.get("uniprot_id"),
            "pathogen_ids": sorted(pathogen_ids),
            "pathogen_names": pathogen_names,
            "pathogen_count": len(pathogen_ids),
            "effector_ids": sorted(host_to_effectors[host_id]),
            "interaction_count": host_to_interactions[host_id],
        })
    multi_pathogen_hosts.sort(key=lambda row: (-row["pathogen_count"], -row["interaction_count"], row["host_protein_id"]))

    evidence_counts = Counter(row["evidence_class"] for row in evidence)
    evidence_per_interaction = [len(evidence_by_interaction.get(row["interaction_id"], [])) for row in interactions]
    interactions_with_evidence = sum(1 for count in evidence_per_interaction if count > 0)
    evidence_source_counts = {
        "records_with_doi": sum(1 for row in evidence if not blank(row.get("doi"))),
        "records_with_pmid": sum(1 for row in evidence if not blank(row.get("pmid"))),
        "records_with_database_accession": sum(1 for row in evidence if not blank(row.get("database_accession"))),
        "records_with_citation": sum(
            1 for row in evidence
            if any(not blank(row.get(field)) for field in ("doi", "pmid", "database_accession"))
        ),
    }

    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    for row in interactions:
        effector = effectors[row["effector_id"]]
        protein = proteins[row["host_protein_id"]]
        pathogen = pathogens.get(effector.get("pathogen_id"))
        pathogen_id = pathogen.get("entity_id") if isinstance(pathogen, dict) else None
        if pathogen_id:
            nodes[pathogen_id] = {
                "id": pathogen_id,
                "type": "pathogen",
                "label": pathogen.get("name"),
                "tax_id": pathogen.get("tax_id"),
                "classification": classify_pathogen(pathogen),
            }
        nodes[row["effector_id"]] = {
            "id": row["effector_id"],
            "type": "effector",
            "label": effector.get("effector_name"),
            "pathogen_id": pathogen_id,
            "host_target_id": effector.get("host_target_id"),
        }
        nodes[row["host_protein_id"]] = {
            "id": row["host_protein_id"],
            "type": "host_protein",
            "label": protein.get("protein_name"),
            "gene_name": protein.get("gene_name"),
            "uniprot_id": protein.get("uniprot_id"),
        }

        evidence_rows = evidence_by_interaction.get(row["interaction_id"], [])
        class_values = sorted({item["evidence_class"] for item in evidence_rows})
        edges.append({
            "id": row["interaction_id"],
            "source": row["effector_id"],
            "target": row["host_protein_id"],
            "type": row.get("interaction_type"),
            "mechanism": row.get("mechanism"),
            "pathogen_id": pathogen_id,
            "pathogen_name": pathogen.get("name") if isinstance(pathogen, dict) else None,
            "provenance": row.get("provenance"),
            "evidence_count": len(evidence_rows),
            "evidence_classes": class_values,
            "strongest_evidence_class": strongest_evidence_class(class_values),
            "evidence_records": [evidence_summary(item) for item in evidence_rows],
        })

    unresolved_targets = collect_unresolved_targets(dataset, pathogens, targets, retained_effector_ids)

    result = {
        "schema_version": OUTPUT_SCHEMA_VERSION,
        "meta": {
            "analysis": "interaction_analysis",
            "analysis_version": ANALYSIS_VERSION,
            "generated_at": utc_now(),
            "source_dataset_path": source_path_label(dataset_path),
            "source_dataset_schema_version": dataset.get("meta", {}).get("schema_version"),
            "source_dataset_built_at": dataset.get("meta", {}).get("built_at"),
            "source_dataset_sha256": hashlib.sha256(source_bytes).hexdigest(),
            "input_tables": INPUT_TABLES,
            "parameters": {**PARAMETERS, **(parameters or {})},
        },
        "validation": {
            "raw_interaction_count": len(raw_interactions),
            "retained_interaction_count": len(interactions),
            "discarded_interaction_count": len(raw_interactions) - len(interactions),
            "interaction_issues": sorted(validation_issues, key=issue_sort_key),
            "raw_evidence_count": len(raw_evidence),
            "retained_evidence_count": len(evidence),
            "discarded_evidence_count": len(raw_evidence) - len(evidence),
            "evidence_issues": sorted(evidence_issues, key=issue_sort_key),
            "issue_counts": {
                "interaction": count_issue_codes(validation_issues),
                "evidence": count_issue_codes(evidence_issues),
                "result": {},
            },
        },
        "statistics": {
            "interaction_count": len(interactions),
            "unique_effector_count": len({row["effector_id"] for row in interactions}),
            "unique_host_protein_count": len({row["host_protein_id"] for row in interactions}),
            "unique_host_target_count": len(unique_target_ids),
            "unique_pathogen_count": len(pathogen_to_interactions),
            "host_proteins_targeted_by_multiple_pathogens_count": len(multi_pathogen_hosts),
            "unresolved_target_count": unresolved_targets["target_count"],
            "unresolved_effector_count": unresolved_targets["effector_count"],
            "evidence_count": len(evidence),
            "interactions_with_evidence_count": interactions_with_evidence,
            "interactions_without_evidence_count": len(interactions) - interactions_with_evidence,
            "mean_evidence_per_interaction": round(len(evidence) / len(interactions), 3) if interactions else 0,
            "median_evidence_per_interaction": statistics.median(evidence_per_interaction) if evidence_per_interaction else 0,
            "evidence_coverage": round(interactions_with_evidence / len(interactions), 3) if interactions else 0,
            "evidence_by_class": dict(sorted(evidence_counts.items())),
            "evidence_source_counts": evidence_source_counts,
            "interactions_by_pathogen": dict(sorted(pathogen_to_interactions.items())),
            "effectors_by_pathogen": {
                pathogen_id: len(effector_ids)
                for pathogen_id, effector_ids in sorted(pathogen_to_effectors.items())
            },
        },
        "host_proteins_targeted_by_multiple_pathogens": multi_pathogen_hosts,
        "unresolved_targets": unresolved_targets,
        "network": {
            "nodes": sorted(nodes.values(), key=lambda item: item["id"]),
            "edges": sorted(edges, key=lambda item: item["id"]),
        },
    }

    result_issues = validate_result(result, dataset=dataset)
    result["validation"]["result_issues"] = sorted(result_issues, key=issue_sort_key)
    result["validation"]["issue_counts"]["result"] = count_issue_codes(result_issues)
    return result


def total_issue_count(result: dict) -> int:
    validation = result["validation"]
    return (
        len(validation["interaction_issues"])
        + len(validation["evidence_issues"])
        + len(validation["result_issues"])
    )


def build(
    *,
    check: bool = False,
    strict: bool = False,
    dataset_path: Path = DATASET_PATH,
    output_path: Path = OUTPUT_PATH,
    sample_output_path: Path | None = None,
) -> int:
    """Analyze the dataset in-process; ``check=True`` writes nothing."""
    with no_writes() if check else nullcontext():
        try:
            source_bytes = dataset_path.read_bytes()
        except OSError as exc:
            print(f"error: cannot read dataset: {exc}", file=sys.stderr)
            return 2
        try:
            dataset = json.loads(source_bytes)
        except json.JSONDecodeError as exc:
            print(f"error: dataset is not valid JSON: {exc}", file=sys.stderr)
            return 2

        result = analyze(dataset, source_bytes, dataset_path=dataset_path)
        if not check:
            write_json(output_path, result)
            if sample_output_path is not None:
                try:
                    sample_bytes = SAMPLE_DATASET_PATH.read_bytes()
                    sample_dataset = json.loads(sample_bytes)
                except (OSError, json.JSONDecodeError) as exc:
                    print(f"error: cannot read sample dataset: {exc}", file=sys.stderr)
                    return 2
                write_json(
                    sample_output_path,
                    analyze(sample_dataset, sample_bytes, dataset_path=SAMPLE_DATASET_PATH),
                )

        stats = result["statistics"]
        print(f"interactions: {stats['interaction_count']}")
        print(f"unique effectors: {stats['unique_effector_count']}")
        print(f"unique host proteins: {stats['unique_host_protein_count']}")
        print(f"unique host targets: {stats['unique_host_target_count']}")
        print(f"multi-pathogen host proteins: {stats['host_proteins_targeted_by_multiple_pathogens_count']}")
        print(f"evidence records: {stats['evidence_count']}")
        issues = total_issue_count(result)
        if issues:
            print(f"validation: {issues} issue(s)", file=sys.stderr)
            for item in (
                result["validation"]["interaction_issues"]
                + result["validation"]["evidence_issues"]
                + result["validation"]["result_issues"]
            )[:10]:
                row = f" [{item['row_id']}]" if item.get("row_id") else ""
                print(f"  {item['code']}{row}: {item['detail']}", file=sys.stderr)
        else:
            print("validation: ok")
        return 1 if strict and issues else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DATASET_PATH, help="source PathoMap dataset JSON")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH, help="derived analysis JSON output path")
    parser.add_argument(
        "--sample-output",
        type=Path,
        help="also write the built-in sample dataset analysis to this path",
    )
    parser.add_argument("--check", action="store_true", help="validate and calculate without writing the JSON artifact")
    parser.add_argument("--strict", action="store_true", help="exit non-zero when validation or result issues exist")
    args = parser.parse_args(argv)
    return build(
        check=args.check,
        strict=args.strict,
        dataset_path=args.dataset,
        output_path=args.output,
        sample_output_path=args.sample_output,
    )


if __name__ == "__main__":
    raise SystemExit(main())

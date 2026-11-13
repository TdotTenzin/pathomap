#!/usr/bin/env python3
"""Compare pathogen effector repertoires, domains, types and host targets.

Similarity is descriptive. Unequal annotation coverage and small repertoires
are reported explicitly; Jaccard similarity is not evidence of shared ancestry.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analysis_common import (
    ROOT,
    count_issue_codes,
    issue,
    issue_sort_key,
    jaccard,
    provenance_meta,
    read_dataset,
    round_or_none,
    status_from_reasons,
    table_rows,
    write_json_atomic,
)

ANALYSIS_VERSION = "1.0"
OUTPUT_SCHEMA_VERSION = "1.0"
OUTPUT_PATH = ROOT / "data" / "derived" / "comparative_pathogen.json"
DATASET_PATH = ROOT / "data" / "pathomap-dataset.json"
PARAMETERS = {
    "similarity": "Jaccard",
    "clustering": "average-linkage agglomerative on 1 - Jaccard",
    "cluster_threshold": 0.7,
    "minimum_effectors_for_clustering": 3,
    "dimensions": ["effector_names", "domain_families", "host_targets", "type_classes"],
    "missing_similarity": None,
    "note": "Similarity reflects annotated profile overlap, not evolutionary origin.",
}
INPUT_TABLES = ["pathogens", "effectors", "host_proteins", "interactions"]


def normalized_name(value: str | None) -> str | None:
    if not value or not str(value).strip():
        return None
    return str(value).strip().lower()


def domain_key(domain: dict) -> str | None:
    accession = str(domain.get("accession") or "").strip()
    if accession:
        return accession
    name = normalized_name(domain.get("name"))
    return f"name:{name}" if name else None


def distance_matrix(ids: list[str], profiles: dict[str, set[str]]) -> list[list[float | None]]:
    matrix: list[list[float | None]] = []
    for left in ids:
        row: list[float | None] = []
        for right in ids:
            similarity = jaccard(profiles.get(left, set()), profiles.get(right, set()))
            row.append(None if similarity is None else round(1.0 - similarity, 6))
        matrix.append(row)
    return matrix


def average_linkage(ids: list[str], matrix: list[list[float | None]]) -> tuple[list[dict], dict[str, int]]:
    index = {item: position for position, item in enumerate(ids)}
    clusters: dict[int, set[str]] = {position: {item} for position, item in enumerate(ids)}
    merge_count = len(ids)
    merges: list[dict] = []

    def pair_distance(left: set[str], right: set[str]) -> float:
        values = []
        for a in left:
            for b in right:
                value = matrix[index[a]][index[b]]
                if value is not None:
                    values.append(value)
        return sum(values) / len(values) if values else 1.0

    while len(clusters) > 1:
        keys = sorted(clusters)
        best = None
        for position, left_key in enumerate(keys):
            for right_key in keys[position + 1:]:
                distance = pair_distance(clusters[left_key], clusters[right_key])
                candidate = (distance, left_key, right_key)
                if best is None or candidate < best:
                    best = candidate
        assert best is not None
        distance, left_key, right_key = best
        merged = clusters.pop(left_key) | clusters.pop(right_key)
        merge_count += 1
        new_key = merge_count
        clusters[new_key] = merged
        merges.append({
            "left": sorted(merged, key=lambda item: index[item]),
            "distance": round(distance, 6),
            "size": len(merged),
        })

    threshold = PARAMETERS["cluster_threshold"]
    assignments: dict[str, int] = {item: position + 1 for position, item in enumerate(ids)}
    for merge in merges:
        if merge["distance"] > threshold:
            continue
        members = set(merge["left"])
        existing = sorted({assignments[item] for item in members})
        target = existing[0]
        for item in members:
            assignments[item] = target
    labels = {
        cluster: index + 1
        for index, cluster in enumerate(sorted(set(assignments.values())))
    }
    assignments = {item: labels[cluster] for item, cluster in assignments.items()}
    return merges, assignments


def analyze(
    dataset: dict,
    source_bytes: bytes,
    *,
    dataset_path: Path | None = None,
    parameters: dict | None = None,
) -> dict:
    table_issues: list[dict] = []
    pathogen_rows = [row for row in table_rows(dataset, "pathogens", table_issues) if isinstance(row, dict)]
    effector_rows = [row for row in table_rows(dataset, "effectors", table_issues) if isinstance(row, dict)]
    host_rows = [row for row in table_rows(dataset, "host_proteins", table_issues) if isinstance(row, dict)]
    interaction_rows = [row for row in table_rows(dataset, "interactions", table_issues) if isinstance(row, dict)]

    pathogens = {str(row.get("pathogen_id")): row for row in pathogen_rows if row.get("pathogen_id") is not None}
    hosts = {row.get("entity_id"): row for row in host_rows if row.get("entity_id")}
    effectors = {row.get("entity_id"): row for row in effector_rows if row.get("entity_id")}
    validation_issues = list(table_issues)

    effectors_by_pathogen: dict[str, list[dict]] = defaultdict(list)
    for row in effector_rows:
        pathogen_id = row.get("pathogen_id")
        if pathogen_id is None:
            validation_issues.append(issue("missing_pathogen_id", "Effector has no pathogen_id.", str(row.get("entity_id"))))
            continue
        effectors_by_pathogen[str(pathogen_id)].append(row)

    targets_by_pathogen: dict[str, set[str]] = defaultdict(set)
    for row in interaction_rows:
        effector = effectors.get(row.get("effector_id"))
        host_id = row.get("host_protein_id")
        if effector and host_id in hosts:
            targets_by_pathogen[str(effector.get("pathogen_id"))].add(host_id)

    profiles: dict[str, dict[str, set[str]]] = {}
    summaries = []
    for pathogen_id, rows in sorted(effectors_by_pathogen.items(), key=lambda item: int(item[0])):
        pathogen = pathogens.get(pathogen_id, {})
        names = {normalized_name(row.get("effector_name")) for row in rows}
        names.discard(None)
        domains: set[str] = set()
        go_terms: set[str] = set()
        types = {str(row.get("type_class") or "unclassified") for row in rows}
        for row in rows:
            for domain in row.get("domains") or []:
                if isinstance(domain, dict):
                    key = domain_key(domain)
                    if key:
                        domains.add(key)
            for term in row.get("go_terms") or []:
                if isinstance(term, dict) and term.get("id"):
                    go_terms.add(str(term["id"]))
        targets = targets_by_pathogen.get(pathogen_id, set())
        profiles[pathogen_id] = {
            "effector_names": names,
            "domain_families": domains,
            "host_targets": targets,
            "type_classes": types,
            "go_terms": go_terms,
        }
        summaries.append({
            "pathogen_id": int(pathogen_id),
            "pathogen_name": pathogen.get("name"),
            "effector_count": len(rows),
            "unique_effector_name_count": len(names),
            "domain_family_count": len(domains),
            "host_target_count": len(targets),
            "go_term_count": len(go_terms),
            "type_classes": dict(sorted(Counter(str(row.get("type_class") or "unclassified") for row in rows).items())),
            "strategy": pathogen.get("strategy"),
            "genome_size_mb": pathogen.get("genome_size_mb"),
            "eligible_for_clustering": len(rows) >= PARAMETERS["minimum_effectors_for_clustering"],
        })

    eligible_ids = [
        pathogen_id
        for pathogen_id, profile in sorted(profiles.items(), key=lambda item: int(item[0]))
        if len(effectors_by_pathogen[pathogen_id]) >= PARAMETERS["minimum_effectors_for_clustering"]
    ]
    eligible_names = {pathogen_id: pathogens.get(pathogen_id, {}).get("name") for pathogen_id in eligible_ids}

    similarity: dict[str, dict] = {}
    clustering: dict[str, dict] = {}
    for dimension in PARAMETERS["dimensions"]:
        dimension_profiles = {
            pathogen_id: profiles[pathogen_id].get(dimension, set())
            for pathogen_id in eligible_ids
        }
        matrix = distance_matrix(eligible_ids, dimension_profiles)
        pairs = []
        for left_index, left in enumerate(eligible_ids):
            for right_index in range(left_index + 1, len(eligible_ids)):
                right = eligible_ids[right_index]
                distance = matrix[left_index][right_index]
                pairs.append({
                    "left_pathogen_id": int(left),
                    "right_pathogen_id": int(right),
                    "similarity": None if distance is None else round(1.0 - distance, 6),
                })
        similarity[dimension] = {
            "dimension": dimension,
            "pathogen_ids": [int(item) for item in eligible_ids],
            "pathogen_names": [eligible_names[item] for item in eligible_ids],
            "distance_matrix": matrix,
            "pairs": pairs,
        }
        merges, assignments = average_linkage(eligible_ids, matrix)
        clustering[dimension] = {
            "dimension": dimension,
            "threshold": PARAMETERS["cluster_threshold"],
            "merges": merges,
            "assignments": [
                {
                    "pathogen_id": int(pathogen_id),
                    "cluster_id": assignments[pathogen_id],
                }
                for pathogen_id in eligible_ids
            ],
        }

    domain_pathogens: dict[str, set[str]] = defaultdict(set)
    effector_name_pathogens: dict[str, set[str]] = defaultdict(set)
    target_pathogens: dict[str, set[str]] = defaultdict(set)
    for pathogen_id, profile in profiles.items():
        for domain in profile["domain_families"]:
            domain_pathogens[domain].add(pathogen_id)
        for name in profile["effector_names"]:
            effector_name_pathogens[name].add(pathogen_id)
        for target in profile["host_targets"]:
            target_pathogens[target].add(pathogen_id)

    shared_domains = [
        {"domain_key": key, "pathogen_count": len(ids), "pathogen_ids": sorted((int(item) for item in ids))}
        for key, ids in domain_pathogens.items()
        if len(ids) >= 2
    ]
    shared_domains.sort(key=lambda row: (-row["pathogen_count"], row["domain_key"]))
    shared_effector_names = [
        {"effector_name": key, "pathogen_count": len(ids), "pathogen_ids": sorted((int(item) for item in ids))}
        for key, ids in effector_name_pathogens.items()
        if len(ids) >= 2
    ]
    shared_effector_names.sort(key=lambda row: (-row["pathogen_count"], row["effector_name"]))
    shared_targets = []
    for host_id, ids in target_pathogens.items():
        if len(ids) < 2:
            continue
        host = hosts.get(host_id, {})
        shared_targets.append({
            "host_protein_id": host_id,
            "protein_name": host.get("protein_name"),
            "gene_name": host.get("gene_name"),
            "pathogen_count": len(ids),
            "pathogen_ids": sorted((int(item) for item in ids)),
        })
    shared_targets.sort(key=lambda row: (-row["pathogen_count"], str(row["host_protein_id"])))

    reasons: list[str] = []
    low_power: list[str] = []
    if len(effectors_by_pathogen) < 2:
        reasons.append("At least two pathogens with effectors are required.")
    elif len(eligible_ids) < 2:
        reasons.append(
            f"Fewer than two pathogens have >= {PARAMETERS['minimum_effectors_for_clustering']} effectors."
        )
    if not reasons and len(eligible_ids) < 3:
        low_power.append(f"Only {len(eligible_ids)} pathogens meet the clustering minimum.")

    result = {
        "schema_version": OUTPUT_SCHEMA_VERSION,
        "status": status_from_reasons(reasons, low_power=low_power),
        "status_reasons": reasons,
        "warnings": low_power,
        "meta": provenance_meta(
            analysis="comparative_pathogen",
            analysis_version=ANALYSIS_VERSION,
            dataset=dataset,
            source_bytes=source_bytes,
            dataset_path=dataset_path,
            input_tables=INPUT_TABLES,
            parameters={**PARAMETERS, **(parameters or {})},
        ),
        "statistics": {
            "pathogen_count": len(effectors_by_pathogen),
            "effector_count": len(effector_rows),
            "eligible_pathogen_count": len(eligible_ids),
            "excluded_pathogen_count": len(effectors_by_pathogen) - len(eligible_ids),
            "shared_domain_count": len(shared_domains),
            "shared_effector_name_count": len(shared_effector_names),
            "shared_host_target_count": len(shared_targets),
        },
        "parameters": {**PARAMETERS, **(parameters or {})},
        "pathogens": summaries,
        "similarity": similarity,
        "clustering": clustering,
        "shared_domains": shared_domains,
        "shared_effector_names": shared_effector_names,
        "shared_host_targets": shared_targets,
        "validation": {
            "issues": sorted(validation_issues, key=issue_sort_key),
            "issue_counts": count_issue_codes(validation_issues),
        },
    }
    return result


def validate_result(result: dict) -> list[dict]:
    issues: list[dict] = []
    for dimension, payload in result.get("similarity", {}).items():
        ids = payload.get("pathogen_ids", [])
        matrix = payload.get("distance_matrix", [])
        if len(matrix) != len(ids):
            issues.append(issue("matrix_shape", "Distance matrix rows do not match pathogens.", dimension))
            continue
        for index, row in enumerate(matrix):
            if len(row) != len(ids):
                issues.append(issue("matrix_shape", "Distance matrix is not square.", dimension))
                break
            if row[index] is not None and abs(row[index]) > 1e-9:
                issues.append(issue("matrix_diagonal", "Distance matrix diagonal is not zero.", dimension))
    for dimension, payload in result.get("clustering", {}).items():
        assigned = {row["pathogen_id"] for row in payload.get("assignments", [])}
        expected = set(result["similarity"].get(dimension, {}).get("pathogen_ids", []))
        if assigned != expected:
            issues.append(issue("cluster_coverage", "Cluster assignments do not cover all pathogens.", dimension))
    return issues


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DATASET_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--check", action="store_true", help="calculate without writing the artifact")
    parser.add_argument("--strict", action="store_true", help="exit non-zero on validation issues")
    args = parser.parse_args(argv)

    try:
        dataset, source_bytes = read_dataset(args.dataset)
    except (OSError, ValueError) as exc:
        print(f"error: cannot read dataset: {exc}", file=sys.stderr)
        return 2

    result = analyze(dataset, source_bytes, dataset_path=args.dataset)
    result_issues = validate_result(result)
    result["validation"]["issues"].extend(result_issues)
    result["validation"]["issues"].sort(key=issue_sort_key)
    result["validation"]["issue_counts"] = count_issue_codes(result["validation"]["issues"])
    if not args.check:
        write_json_atomic(args.output, result)

    stats = result["statistics"]
    print(f"status: {result['status']}")
    print(f"pathogens: {stats['pathogen_count']} ({stats['eligible_pathogen_count']} eligible for clustering)")
    print(f"shared domains: {stats['shared_domain_count']}")
    print(f"shared host targets: {stats['shared_host_target_count']}")
    issues = result["validation"]["issues"]
    if issues:
        print(f"validation: {len(issues)} issue(s)", file=sys.stderr)
        for item in issues[:10]:
            row = f" [{item['row_id']}]" if item.get("row_id") else ""
            print(f"  {item['code']}{row}: {item['detail']}", file=sys.stderr)
    else:
        print("validation: ok")
    return 1 if args.strict and issues else 0


if __name__ == "__main__":
    raise SystemExit(main())

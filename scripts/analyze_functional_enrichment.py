#!/usr/bin/env python3
"""GO over-representation analysis for effector-targeted host proteins.

Foreground: host proteins with a retained curated interaction.
Background: all annotated host proteins in the loaded dataset.
Small backgrounds are reported as low power rather than silent significance.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analysis_common import (
    ROOT,
    bh_adjust,
    count_issue_codes,
    hypergeom_sf,
    issue,
    issue_sort_key,
    provenance_meta,
    read_dataset,
    round_or_none,
    status_from_reasons,
    table_rows,
    write_json_atomic,
)

ANALYSIS_VERSION = "1.0"
OUTPUT_SCHEMA_VERSION = "1.0"
OUTPUT_PATH = ROOT / "data" / "derived" / "functional_enrichment.json"
DATASET_PATH = ROOT / "data" / "pathomap-dataset.json"
ASPECT_NAMES = {
    "F": "molecular_function",
    "P": "biological_process",
    "C": "cellular_component",
}
PARAMETERS = {
    "test": "one-sided hypergeometric over-representation",
    "multiple_testing": "Benjamini-Hochberg within GO aspect",
    "significance_threshold": 0.05,
    "min_background_term_size": 2,
    "min_foreground_overlap": 1,
    "minimum_foreground_size": 3,
    "low_power_foreground_size": 10,
    "low_power_background_size": 20,
    "background": "all host proteins with GO annotations",
    "foreground": "host proteins in retained curated interactions",
}
INPUT_TABLES = ["host_proteins", "interactions"]


def go_annotations(row: dict) -> dict[str, dict]:
    terms: dict[str, dict] = {}
    for term in row.get("go_terms") or []:
        if not isinstance(term, dict):
            continue
        go_id = term.get("id")
        aspect = term.get("aspect")
        if not go_id or aspect not in ASPECT_NAMES:
            continue
        terms[str(go_id)] = {
            "id": str(go_id),
            "term": term.get("term") or "",
            "aspect": aspect,
        }
    return terms


def term_name(store: dict[str, str], go_id: str, fallback: str = "") -> str:
    return store.get(go_id) or fallback or go_id


def analyze(
    dataset: dict,
    source_bytes: bytes,
    *,
    dataset_path: Path | None = None,
    parameters: dict | None = None,
) -> dict:
    table_issues: list[dict] = []
    host_rows = table_rows(dataset, "host_proteins", table_issues)
    interaction_rows = table_rows(dataset, "interactions", table_issues)

    hosts = {
        row.get("entity_id"): row
        for row in host_rows
        if isinstance(row, dict) and row.get("entity_id")
    }
    foreground_ids = {
        row.get("host_protein_id")
        for row in interaction_rows
        if isinstance(row, dict) and row.get("host_protein_id") in hosts
    }
    background_ids = {
        entity_id for entity_id, row in hosts.items() if go_annotations(row)
    }

    validation_issues = list(table_issues)
    for entity_id in sorted(foreground_ids - background_ids):
        validation_issues.append(issue("foreground_without_annotation", "Targeted host protein has no GO annotation.", entity_id))

    term_proteins: dict[str, dict[str, set[str]]] = {
        aspect: defaultdict(set) for aspect in ASPECT_NAMES
    }
    term_names: dict[str, str] = {}
    for entity_id, row in hosts.items():
        for go_id, term in go_annotations(row).items():
            term_proteins[term["aspect"]][go_id].add(entity_id)
            term_names.setdefault(go_id, term["term"])

    aspects: dict[str, dict] = {}
    all_terms: list[dict] = []
    for aspect, name in ASPECT_NAMES.items():
        background_aspect = {
            entity_id
            for entity_id, row in hosts.items()
            if any(term["aspect"] == aspect for term in go_annotations(row).values())
        }
        foreground_aspect = foreground_ids & background_aspect
        tested = []
        for go_id, proteins in term_proteins[aspect].items():
            background_count = len(proteins & background_aspect)
            foreground_count = len(proteins & foreground_aspect)
            if background_count < 2 or foreground_count < 1:
                continue
            p_value = hypergeom_sf(
                foreground_count,
                len(background_aspect),
                background_count,
                len(foreground_aspect),
            )
            fold = None
            if foreground_aspect and background_aspect and background_count:
                fold = (foreground_count / len(foreground_aspect)) / (background_count / len(background_aspect))
            tested.append({
                "term_id": go_id,
                "term_name": term_name(term_names, go_id),
                "database": "GO",
                "aspect": aspect,
                "aspect_name": name,
                "input_count": foreground_count,
                "background_count": background_count,
                "input_total": len(foreground_aspect),
                "background_total": len(background_aspect),
                "fold_enrichment": round_or_none(fold, 3),
                "p_value": p_value,
                "contributing_protein_ids": sorted(proteins & foreground_aspect),
            })
        q_values = bh_adjust([row["p_value"] for row in tested])
        for row, q_value in zip(tested, q_values):
            row["q_value"] = q_value
            row["significant"] = q_value <= 0.05
            row["p_value"] = round_or_none(row["p_value"], 6)
            row["q_value"] = round_or_none(row["q_value"], 6)
        tested.sort(key=lambda row: (row["q_value"], row["p_value"], row["term_id"]))
        aspects[aspect] = {
            "aspect": aspect,
            "aspect_name": name,
            "foreground_total": len(foreground_aspect),
            "background_total": len(background_aspect),
            "tested_term_count": len(tested),
            "significant_term_count": sum(1 for row in tested if row["significant"]),
            "terms": tested,
        }
        all_terms.extend(tested)

    unmapped_foreground = sorted(foreground_ids - background_ids)
    mapped_foreground = sorted(foreground_ids & background_ids)
    tested_terms = sum(item["tested_term_count"] for item in aspects.values())
    significant_terms = sum(item["significant_term_count"] for item in aspects.values())

    reasons: list[str] = []
    low_power: list[str] = []
    if not foreground_ids:
        reasons.append("No host proteins are targeted by retained interactions.")
    elif len(foreground_ids) < PARAMETERS["minimum_foreground_size"]:
        reasons.append(f"Foreground has {len(foreground_ids)} proteins; at least {PARAMETERS['minimum_foreground_size']} are required.")
    if not background_ids:
        reasons.append("No host proteins have GO annotations.")
    if not reasons and tested_terms == 0:
        reasons.append("No GO terms meet the minimum background/foreground size rules.")
    if not reasons:
        if len(foreground_ids) < PARAMETERS["low_power_foreground_size"]:
            low_power.append(f"Foreground has only {len(foreground_ids)} annotated proteins.")
        if len(background_ids) < PARAMETERS["low_power_background_size"]:
            low_power.append(f"Background has only {len(background_ids)} annotated proteins.")

    result = {
        "schema_version": OUTPUT_SCHEMA_VERSION,
        "status": status_from_reasons(reasons, low_power=low_power),
        "status_reasons": reasons,
        "warnings": low_power,
        "meta": provenance_meta(
            analysis="functional_enrichment",
            analysis_version=ANALYSIS_VERSION,
            dataset=dataset,
            source_bytes=source_bytes,
            dataset_path=dataset_path,
            input_tables=INPUT_TABLES,
            parameters={**PARAMETERS, **(parameters or {})},
        ),
        "statistics": {
            "foreground_protein_count": len(foreground_ids),
            "mapped_foreground_protein_count": len(mapped_foreground),
            "background_protein_count": len(background_ids),
            "unmapped_foreground_protein_count": len(unmapped_foreground),
            "annotation_coverage": round(len(mapped_foreground) / len(foreground_ids), 3) if foreground_ids else 0,
            "tested_term_count": tested_terms,
            "significant_term_count": significant_terms,
            "aspects_tested": len([item for item in aspects.values() if item["tested_term_count"]]),
        },
        "foreground_protein_ids": sorted(foreground_ids),
        "background_protein_ids": sorted(background_ids),
        "unmapped_protein_ids": unmapped_foreground,
        "aspects": aspects,
        "terms": sorted(all_terms, key=lambda row: (row["aspect"], row["q_value"], row["p_value"], row["term_id"])),
        "validation": {
            "issues": sorted(validation_issues, key=issue_sort_key),
            "issue_counts": count_issue_codes(validation_issues),
        },
    }
    return result


def validate_result(result: dict) -> list[dict]:
    issues: list[dict] = []
    for term in result.get("terms", []):
        if not (0.0 <= term["p_value"] <= 1.0):
            issues.append(issue("p_value_range", "p-value outside [0, 1].", term.get("term_id")))
        if not (0.0 <= term["q_value"] <= 1.0):
            issues.append(issue("q_value_range", "q-value outside [0, 1].", term.get("term_id")))
        if term["input_count"] > term["input_total"]:
            issues.append(issue("input_count", "Input count exceeds input total.", term.get("term_id")))
    counted = sum(item["tested_term_count"] for item in result.get("aspects", {}).values())
    if counted != len(result.get("terms", [])):
        issues.append(issue("term_count_mismatch", "Aspect and flat term counts disagree."))
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
    print(f"foreground: {stats['foreground_protein_count']} ({stats['mapped_foreground_protein_count']} mapped)")
    print(f"background: {stats['background_protein_count']}")
    print(f"GO terms tested: {stats['tested_term_count']}; significant: {stats['significant_term_count']}")
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

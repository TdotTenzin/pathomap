#!/usr/bin/env python3
"""Analyze effector sequences, composition and annotated conserved domains.

Reads the curated effector rows and writes a derived feature artifact. Sequence
properties are computed, not curated facts; domain summaries are
annotation-derived and do not establish evolutionary conservation.
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
from analysis_common import (
    ROOT,
    blank,
    count_issue_codes,
    issue,
    issue_sort_key,
    mean,
    median,
    provenance_meta,
    read_dataset,
    round_or_none,
    status_from_reasons,
    table_rows,
    write_json_atomic,
)
from build_effectors_host_proteins import calculate_molecular_features, clean_sequence
from identifiers import is_entity_id

ANALYSIS_VERSION = "1.0"
OUTPUT_SCHEMA_VERSION = "1.0"
OUTPUT_PATH = ROOT / "data" / "derived" / "effector_sequence_analysis.json"
DATASET_PATH = ROOT / "data" / "pathomap-dataset.json"
CANONICAL_AA = "ACDEFGHIKLMNPQRSTVWY"
VALID_AA = set(CANONICAL_AA) | set("BZJXUO*")
MOTIFS = {
    "RxLR": re.compile(r"R.LR"),
    "PEXEL": re.compile(r"R.L.[DEQ]"),
}
LOW_COMPLEXITY_WINDOW = 12
LOW_COMPLEXITY_ENTROPY = 2.2
PARAMETERS = {
    "low_complexity_window": LOW_COMPLEXITY_WINDOW,
    "low_complexity_entropy_bits": LOW_COMPLEXITY_ENTROPY,
    "motifs": sorted(MOTIFS),
    "domain_family_key": "accession_or_normalized_name",
    "n_terminal_length": 30,
    "minimum_sequence_length": 1,
}
INPUT_TABLES = ["pathogens", "effectors"]
EXPORT_COLUMNS = [
    "entity_id",
    "pathogen_id",
    "effector_name",
    "type_class",
    "sequence_length",
    "molecular_weight_da",
    "isoelectric_point",
    "gravy_score",
    "shannon_entropy_bits",
    "aliphatic_index",
    "aromaticity",
    "cysteine_fraction",
    "proline_fraction",
    "glycine_fraction",
    "low_complexity_fraction",
    "domain_count",
    "domain_coverage",
    "motifs",
    "feature_status",
]


def entropy(fragment: str) -> float:
    counts = Counter(aa for aa in fragment if aa in CANONICAL_AA)
    total = sum(counts.values())
    if total <= 0:
        return 0.0
    return -sum((count / total) * math.log2(count / total) for count in counts.values())


def composition(sequence: str) -> dict[str, float]:
    counts = Counter(sequence)
    total = len(sequence)
    if total == 0:
        return {aa: 0.0 for aa in CANONICAL_AA}
    return {aa: round(counts.get(aa, 0) / total, 6) for aa in CANONICAL_AA}


def residue_fraction(sequence: str, residues: str) -> float:
    if not sequence:
        return 0.0
    return round(sum(1 for aa in sequence if aa in residues) / len(sequence), 6)


def aliphatic_index(sequence: str) -> float:
    if not sequence:
        return 0.0
    counts = Counter(sequence)
    total = len(sequence)
    percent = {aa: 100.0 * counts.get(aa, 0) / total for aa in CANONICAL_AA}
    value = (
        percent["A"]
        + 2.9 * percent["V"]
        + 3.9 * (percent["I"] + percent["L"])
    )
    return round(value, 3)


def low_complexity_fraction(sequence: str) -> float:
    if len(sequence) < LOW_COMPLEXITY_WINDOW:
        return 0.0
    covered: set[int] = set()
    for start in range(0, len(sequence) - LOW_COMPLEXITY_WINDOW + 1):
        fragment = sequence[start : start + LOW_COMPLEXITY_WINDOW]
        if entropy(fragment) <= LOW_COMPLEXITY_ENTROPY:
            covered.update(range(start, start + LOW_COMPLEXITY_WINDOW))
    return round(len(covered) / len(sequence), 4)


def motif_hits(sequence: str) -> list[dict]:
    hits = []
    for name, pattern in sorted(MOTIFS.items()):
        positions = [match.start() + 1 for match in pattern.finditer(sequence)]
        if positions:
            hits.append({"name": name, "positions": positions, "count": len(positions)})
    return hits


def domain_family_key(domain: dict) -> tuple[str, str]:
    accession = str(domain.get("accession") or "").strip()
    name = str(domain.get("name") or "").strip()
    if accession:
        return accession, name or accession
    if name:
        return f"name:{name.lower()}", name
    return "name:unnamed", "Unnamed domain"


def domain_coverage(domains: list[dict], sequence_length: int | None) -> float | None:
    if not sequence_length:
        return None
    intervals: list[tuple[int, int]] = []
    for domain in domains:
        start, end = domain.get("start"), domain.get("end")
        if isinstance(start, int) and isinstance(end, int) and 0 < start <= end:
            intervals.append((start, end))
    if not intervals:
        return None
    intervals.sort()
    merged: list[list[int]] = []
    for start, end in intervals:
        if merged and start <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    covered = sum(end - start + 1 for start, end in merged)
    return round(min(1.0, covered / sequence_length), 4)


def summary(values: list[float | None]) -> dict:
    cleaned = [float(value) for value in values if isinstance(value, (int, float))]
    return {
        "count": len(cleaned),
        "mean": round_or_none(mean(cleaned)),
        "median": round_or_none(median(cleaned)),
        "min": round(min(cleaned), 4) if cleaned else None,
        "max": round(max(cleaned), 4) if cleaned else None,
    }


def analyze(
    dataset: dict,
    source_bytes: bytes,
    *,
    dataset_path: Path | None = None,
    parameters: dict | None = None,
) -> dict:
    table_issues: list[dict] = []
    effector_rows = table_rows(dataset, "effectors", table_issues)
    pathogen_rows = table_rows(dataset, "pathogens", table_issues)
    pathogens = {
        row.get("pathogen_id"): row
        for row in pathogen_rows
        if isinstance(row, dict) and row.get("pathogen_id") is not None
    }

    validation_issues = list(table_issues)
    features: list[dict] = []
    family_index: dict[str, dict] = {}
    missing_sequences: list[dict] = []
    seen_ids: set[str] = set()

    for row in effector_rows:
        if not isinstance(row, dict):
            validation_issues.append(issue("invalid_row", "Effector row is not an object."))
            continue
        entity_id = row.get("entity_id")
        if not is_entity_id(entity_id, "effector"):
            validation_issues.append(issue("invalid_effector_id", "Effector ID is not a PM-EFF identifier.", str(entity_id)))
            continue
        if entity_id in seen_ids:
            validation_issues.append(issue("duplicate_effector_id", "Duplicate effector ID discarded.", entity_id))
            continue
        seen_ids.add(entity_id)

        raw_sequence = row.get("sequence")
        sequence = clean_sequence(raw_sequence) if isinstance(raw_sequence, str) else ""
        invalid = bool(sequence) and any(aa not in VALID_AA for aa in sequence)
        if invalid:
            validation_issues.append(issue("invalid_sequence_characters", "Sequence contains unsupported characters.", entity_id))
        length = len(sequence) if sequence and not invalid else None
        feature_status = "computed" if length else "missing_sequence"
        if invalid:
            feature_status = "invalid_sequence"
        if not length:
            missing_sequences.append({
                "entity_id": entity_id,
                "effector_name": row.get("effector_name"),
                "pathogen_id": row.get("pathogen_id"),
                "reason": "invalid_sequence" if invalid else "missing_sequence",
            })

        molecular = calculate_molecular_features(sequence) if length else {
            "molecular_weight_da": None,
            "isoelectric_point": None,
            "gravy_score": None,
        }
        domains = row.get("domains") if isinstance(row.get("domains"), list) else []
        coverage = domain_coverage(domains, length)
        composition_values = composition(sequence) if length else {aa: 0.0 for aa in CANONICAL_AA}
        hits = motif_hits(sequence) if length else []
        signal = row.get("signal_peptide")
        transmembrane = row.get("transmembrane_regions")
        feature = {
            "entity_id": entity_id,
            "pathogen_id": row.get("pathogen_id"),
            "effector_name": row.get("effector_name"),
            "type_class": row.get("type_class") or "unclassified",
            "sequence_length": length,
            "molecular_weight_da": molecular["molecular_weight_da"],
            "isoelectric_point": molecular["isoelectric_point"],
            "gravy_score": molecular["gravy_score"],
            "amino_acid_composition": composition_values,
            "shannon_entropy_bits": round(entropy(sequence), 4) if length else None,
            "aliphatic_index": aliphatic_index(sequence) if length else None,
            "aromaticity": residue_fraction(sequence, "FYW") if length else None,
            "cysteine_fraction": residue_fraction(sequence, "C") if length else None,
            "proline_fraction": residue_fraction(sequence, "P") if length else None,
            "glycine_fraction": residue_fraction(sequence, "G") if length else None,
            "low_complexity_fraction": low_complexity_fraction(sequence) if length else None,
            "n_terminal_composition": composition(sequence[:30]) if length else None,
            "motifs": hits,
            "signal_peptide_annotated": bool(signal),
            "transmembrane_region_count": len(transmembrane) if isinstance(transmembrane, list) else 0,
            "domain_count": len(domains),
            "domain_coverage": coverage,
            "feature_status": feature_status,
            "evidence_class": "computed",
        }
        features.append(feature)

        for domain in domains:
            if not isinstance(domain, dict):
                continue
            key, family_name = domain_family_key(domain)
            entry = family_index.setdefault(key, {
                "family_key": key,
                "family_name": family_name,
                "accession": str(domain.get("accession") or "") or None,
                "effector_ids": set(),
                "pathogen_ids": set(),
                "type_classes": set(),
                "with_coordinates": 0,
            })
            entry["effector_ids"].add(entity_id)
            if row.get("pathogen_id") is not None:
                entry["pathogen_ids"].add(row.get("pathogen_id"))
            entry["type_classes"].add(feature["type_class"])
            if isinstance(domain.get("start"), int) and isinstance(domain.get("end"), int):
                entry["with_coordinates"] += 1

    features.sort(key=lambda row: row["entity_id"])
    missing_sequences.sort(key=lambda row: row["entity_id"])

    domain_families = []
    for entry in family_index.values():
        domain_families.append({
            "family_key": entry["family_key"],
            "family_name": entry["family_name"],
            "accession": entry["accession"],
            "effector_count": len(entry["effector_ids"]),
            "pathogen_count": len(entry["pathogen_ids"]),
            "effector_ids": sorted(entry["effector_ids"]),
            "pathogen_ids": sorted(entry["pathogen_ids"]),
            "type_classes": sorted(entry["type_classes"]),
            "annotated_with_coordinates": entry["with_coordinates"],
            "evidence_class": "annotation-derived",
        })
    domain_families.sort(key=lambda row: (-row["effector_count"], row["family_key"]))
    shared_families = [row for row in domain_families if row["pathogen_count"] >= 2]

    by_pathogen = []
    features_by_pathogen: dict[Any, list[dict]] = defaultdict(list)
    for feature in features:
        features_by_pathogen[feature["pathogen_id"]].append(feature)
    for pathogen_id, rows in sorted(features_by_pathogen.items(), key=lambda item: str(item[0])):
        pathogen = pathogens.get(pathogen_id, {})
        by_pathogen.append({
            "pathogen_id": pathogen_id,
            "pathogen_name": pathogen.get("name"),
            "effector_count": len(rows),
            "sequenced_count": sum(1 for row in rows if row["sequence_length"]),
            "missing_sequence_count": sum(1 for row in rows if not row["sequence_length"]),
            "length": summary([row["sequence_length"] for row in rows]),
            "gravy": summary([row["gravy_score"] for row in rows]),
            "isoelectric_point": summary([row["isoelectric_point"] for row in rows]),
            "domain_count": summary([row["domain_count"] for row in rows]),
        })

    by_type = []
    features_by_type: dict[str, list[dict]] = defaultdict(list)
    for feature in features:
        features_by_type[feature["type_class"]].append(feature)
    for type_class, rows in sorted(features_by_type.items()):
        by_type.append({
            "type_class": type_class,
            "effector_count": len(rows),
            "sequenced_count": sum(1 for row in rows if row["sequence_length"]),
            "length": summary([row["sequence_length"] for row in rows]),
            "gravy": summary([row["gravy_score"] for row in rows]),
            "domain_count": summary([row["domain_count"] for row in rows]),
            "motif_effector_count": sum(1 for row in rows if row["motifs"]),
        })

    reasons: list[str] = []
    if not features:
        reasons.append("No effector rows were available.")
    elif not any(row["sequence_length"] for row in features):
        reasons.append("No effector has a valid amino-acid sequence.")

    statistics = {
        "effector_count": len(features),
        "sequenced_count": sum(1 for row in features if row["sequence_length"]),
        "missing_sequence_count": len(missing_sequences),
        "invalid_sequence_count": sum(1 for row in missing_sequences if row["reason"] == "invalid_sequence"),
        "domain_family_count": len(domain_families),
        "shared_domain_family_count": len(shared_families),
        "effectors_with_domains": sum(1 for row in features if row["domain_count"] > 0),
        "effectors_with_motifs": sum(1 for row in features if row["motifs"]),
        "effectors_with_signal_peptide": sum(1 for row in features if row["signal_peptide_annotated"]),
        "effectors_with_transmembrane_regions": sum(1 for row in features if row["transmembrane_region_count"] > 0),
    }

    result = {
        "schema_version": OUTPUT_SCHEMA_VERSION,
        "status": status_from_reasons(reasons),
        "status_reasons": reasons,
        "meta": provenance_meta(
            analysis="effector_sequence_analysis",
            analysis_version=ANALYSIS_VERSION,
            dataset=dataset,
            source_bytes=source_bytes,
            dataset_path=dataset_path,
            input_tables=INPUT_TABLES,
            parameters={**PARAMETERS, **(parameters or {})},
        ),
        "statistics": statistics,
        "features": features,
        "domain_families": domain_families,
        "shared_domain_families": shared_families,
        "by_pathogen": by_pathogen,
        "by_type_class": by_type,
        "missing_sequences": missing_sequences,
        "export_columns": EXPORT_COLUMNS,
        "validation": {
            "issues": sorted(validation_issues, key=issue_sort_key),
            "issue_counts": count_issue_codes(validation_issues),
        },
    }
    return result


def validate_result(result: dict) -> list[dict]:
    issues: list[dict] = []
    features = result.get("features", [])
    seen: set[str] = set()
    for row in features:
        entity_id = row.get("entity_id")
        if entity_id in seen:
            issues.append(issue("duplicate_feature_id", "Duplicate effector feature row.", str(entity_id)))
        seen.add(entity_id)
        composition_values = row.get("amino_acid_composition") or {}
        if row.get("sequence_length") and composition_values:
            total = sum(composition_values.values())
            if abs(total - 1.0) > 0.01:
                issues.append(issue("composition_sum", f"Composition sums to {total:.4f}.", str(entity_id)))
        coverage = row.get("domain_coverage")
        if coverage is not None and not (0.0 <= coverage <= 1.0):
            issues.append(issue("domain_coverage_range", "Domain coverage outside [0, 1].", str(entity_id)))
    if result["statistics"]["effector_count"] != len(features):
        issues.append(issue("feature_count_mismatch", "Statistics and feature rows disagree."))
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
    print(f"effectors: {stats['effector_count']}")
    print(f"sequenced: {stats['sequenced_count']}")
    print(f"missing sequences: {stats['missing_sequence_count']}")
    print(f"domain families: {stats['domain_family_count']} ({stats['shared_domain_family_count']} shared)")
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

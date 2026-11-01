#!/usr/bin/env python3
"""Build the PathoMap effectors and host_proteins tables.

The curated seed files are enriched with pathogen_id mappings from the pathogens
table, validated, and written to:

  data/pathomap-dataset.json (updated with effectors and host_proteins)
  data/sample-dataset.json (updated with effectors and host_proteins)

Usage:
  python scripts/build_effectors_host_proteins.py
  python scripts/build_effectors_host_proteins.py --check
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PATHOGENS_DATASET_PATH = ROOT / "data" / "pathomap-dataset.json"
SAMPLE_DATASET_PATH = ROOT / "data" / "sample-dataset.json"
EFFECTORS_SEED_PATH = ROOT / "data" / "sources" / "effectors_seed.json"
HOST_PROTEINS_SEED_PATH = ROOT / "data" / "sources" / "host_proteins_seed.json"

SCHEMA_VERSION = "2.0"
DATASET_NAME = "pathomap"

# Sample pathogen IDs from build_pathogens.py
SAMPLE_PATHOGEN_IDS = [1, 3, 13, 32, 48]

# Sample pathogen names (for filtering effectors)
SAMPLE_PATHOGEN_NAMES = [
    "Salmonella enterica serovar Typhimurium",
    "Mycobacterium tuberculosis",
    "Anaplasma phagocytophilum",
    "Bacillus anthracis",
    "Acinetobacter baumannii",
]


class BuildError(RuntimeError):
    pass


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def read_pathogens(dataset_path: Path) -> dict[str, dict]:
    """Read pathogens and create a mapping from name to pathogen record."""
    dataset = read_json(dataset_path)
    pathogens = dataset.get("pathogens", [])
    return {p["name"]: p for p in pathogens}


def validate_effectors(effectors: list[dict]) -> list[str]:
    """Validate effector records."""
    errors: list[str] = []
    seen: set[tuple] = set()

    for index, row in enumerate(effectors):
        label = f"row {index}"

        # Check required fields
        required = ["effector_name", "pathogen_name", "type", "host_target", "mechanism"]
        for key in required:
            value = row.get(key)
            if value is None or (isinstance(value, str) and not value.strip()):
                errors.append(f"{label}: missing required field {key}")

        # Check for duplicates
        key = (row.get("effector_name"), row.get("pathogen_name"))
        if key in seen:
            errors.append(f"{label}: duplicate effector {key}")
        seen.add(key)

    return errors


def validate_host_proteins(host_proteins: list[dict]) -> list[str]:
    """Validate host_protein records."""
    errors: list[str] = []
    seen_ids: set[int] = set()
    seen_uniprot: set[str] = set()

    for index, row in enumerate(host_proteins):
        label = f"row {index} ({row.get('protein_name', '?')})"

        # Check required fields
        required = [
            "host_protein_id",
            "protein_name",
            "gene_name",
            "uniprot_id",
            "localization",
            "function",
            "curation_status",
            "last_updated",
        ]
        for key in required:
            value = row.get(key)
            if value is None or (isinstance(value, str) and not value.strip()):
                errors.append(f"{label}: missing required field {key}")

        # Check IDs
        pid = row.get("host_protein_id")
        if not isinstance(pid, int) or pid <= 0:
            errors.append(f"{label}: host_protein_id must be a positive integer")
        elif pid in seen_ids:
            errors.append(f"{label}: duplicate host_protein_id {pid}")
        else:
            seen_ids.add(pid)

        # Check UniProt ID
        uniprot = row.get("uniprot_id")
        if isinstance(uniprot, str):
            if uniprot in seen_uniprot:
                errors.append(f"{label}: duplicate uniprot_id {uniprot!r}")
            seen_uniprot.add(uniprot)

        # Check curation_status
        if row.get("curation_status") not in ["curated", "needs_review"]:
            errors.append(f"{label}: invalid curation_status {row.get('curation_status')!r}")

        # Check DOI
        doi = row.get("reference_doi")
        if doi is not None and (not isinstance(doi, str) or not doi.startswith("10.")):
            errors.append(f"{label}: reference_doi must be a DOI starting with 10. or null")

        # Check date
        try:
            dt.date.fromisoformat(row.get("last_updated", ""))
        except ValueError:
            errors.append(f"{label}: last_updated must be an ISO date")

    return errors


def build_tables(args: argparse.Namespace) -> tuple[list[dict], list[dict]]:
    """Build effectors and host_proteins tables from seed files."""
    # Read seed files
    if not EFFECTORS_SEED_PATH.exists():
        raise BuildError(f"missing seed file {EFFECTORS_SEED_PATH}")
    if not HOST_PROTEINS_SEED_PATH.exists():
        raise BuildError(f"missing seed file {HOST_PROTEINS_SEED_PATH}")

    effectors = read_json(EFFECTORS_SEED_PATH)
    host_proteins = read_json(HOST_PROTEINS_SEED_PATH)

    # Read pathogens to validate pathogen_name references
    pathogens = read_pathogens(PATHOGENS_DATASET_PATH)

    # Validate that all pathogen_name references exist in pathogens table
    for effector in effectors:
        pathogen_name = effector.get("pathogen_name")
        if pathogen_name not in pathogens:
            raise BuildError(
                f"effector references unknown pathogen {pathogen_name!r}"
            )

    return effectors, host_proteins


def filter_sample(
    effectors: list[dict], host_proteins: list[dict]
) -> tuple[list[dict], list[dict]]:
    """Filter effectors and host_proteins for the sample dataset."""
    # Filter effectors by sample pathogen names
    sample_effectors = [
        e for e in effectors if e.get("pathogen_name") in SAMPLE_PATHOGEN_NAMES
    ]

    # For host_proteins, keep all (currently only 5, same as sample)
    # In the future, could filter by which proteins are referenced by sample effectors
    sample_host_proteins = host_proteins

    return sample_effectors, sample_host_proteins


def update_dataset(
    dataset_path: Path,
    effectors: list[dict],
    host_proteins: list[dict],
) -> dict:
    """Update the dataset file with new effectors and host_proteins tables."""
    dataset = read_json(dataset_path)

    # Update meta
    dataset["meta"]["tables"]["effectors"] = len(effectors)
    dataset["meta"]["tables"]["host_proteins"] = len(host_proteins)
    dataset["meta"]["built_at"] = (
        dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )

    # Update tables
    dataset["effectors"] = effectors
    dataset["host_proteins"] = host_proteins

    return dataset


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate without writing output files")
    args = parser.parse_args()

    if not PATHOGENS_DATASET_PATH.exists():
        print(f"error: missing pathogens dataset {PATHOGENS_DATASET_PATH}", file=sys.stderr)
        return 1

    try:
        effectors, host_proteins = build_tables(args)
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    # Validate
    effector_errors = validate_effectors(effectors)
    host_protein_errors = validate_host_proteins(host_proteins)

    if effector_errors:
        print(f"effector validation errors: {len(effector_errors)}", file=sys.stderr)
        for error in effector_errors:
            print(f"  - {error}", file=sys.stderr)

    if host_protein_errors:
        print(f"host_protein validation errors: {len(host_protein_errors)}", file=sys.stderr)
        for error in host_protein_errors:
            print(f"  - {error}", file=sys.stderr)

    if effector_errors or host_protein_errors:
        return 1

    print(f"effectors: {len(effectors)}")
    print(f"host_proteins: {len(host_proteins)}")
    print("validation: ok")

    if args.check:
        return 0

    # Filter for sample
    sample_effectors, sample_host_proteins = filter_sample(effectors, host_proteins)
    print(f"sample effectors: {len(sample_effectors)}")
    print(f"sample host_proteins: {len(sample_host_proteins)}")

    # Update full dataset
    full_dataset = update_dataset(PATHOGENS_DATASET_PATH, effectors, host_proteins)
    write_json(PATHOGENS_DATASET_PATH, full_dataset)
    print(f"updated {PATHOGENS_DATASET_PATH.relative_to(ROOT)}")

    # Update sample dataset
    sample_dataset = update_dataset(SAMPLE_DATASET_PATH, sample_effectors, sample_host_proteins)
    write_json(SAMPLE_DATASET_PATH, sample_dataset)
    print(f"updated {SAMPLE_DATASET_PATH.relative_to(ROOT)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Build the PathoMap effectors and host_proteins tables.

The curated seed files are enriched with pathogen_id mappings from the pathogens
table, optionally enriched with protein data from external APIs (UniProt,
InterPro, Pfam, STRING), validated, and written to:

  data/pathomap-dataset.json (updated with effectors and host_proteins)
  data/sample-dataset.json (updated with effectors and host_proteins)
  data/pathomap.db (SQLite database appends effectors and host_proteins tables)
  data/schema.sql (appends SQL schema for effectors and host_proteins)

Usage:
  python scripts/build_effectors_host_proteins.py
  python scripts/build_effectors_host_proteins.py --check
  python scripts/build_effectors_host_proteins.py --enrich-effectors
  python scripts/build_effectors_host_proteins.py --enrich-effectors --refresh
  python scripts/build_effectors_host_proteins.py --enrich-effectors --no-network
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any

# Add scripts directory to path for relative imports when run as module
sys.path.insert(0, str(Path(__file__).parent))

from identifiers import (
    assign_effector_ids,
    assign_registry_ids,
    entity_id,
    host_target_key,
    is_entity_id,
    load_effector_registry,
    load_registry,
    reference_key,
    validate_effector_registry,
    validate_registry,
    write_effector_registry,
    write_registry,
)
from api_clients import (
    ApiError,
    extract_domains,
    extract_go_terms,
    extract_pathways,
    extract_sequence,
    extract_signal_peptide,
    extract_transmembrane_regions,
    fetch_interpro_domains,
    fetch_pfam_domains,
    fetch_string_interactions,
    fetch_uniprot_entry,
    search_uniprot,
)

ROOT = Path(__file__).resolve().parents[1]
PATHOGENS_DATASET_PATH = ROOT / "data" / "pathomap-dataset.json"
SAMPLE_DATASET_PATH = ROOT / "data" / "sample-dataset.json"
EFFECTORS_SEED_PATH = ROOT / "data" / "sources" / "effectors_seed.json"
HOST_PROTEINS_SEED_PATH = ROOT / "data" / "sources" / "host_proteins_seed.json"
HOST_PROTEINS_AUDIT_SEED_PATH = ROOT / "data" / "sources" / "host_proteins_audit_seed.json"
HOST_TARGET_AUDIT_PATH = ROOT / "data" / "sources" / "host_target_audit.json"
CLASSIFICATION_MAPPING_PATH = ROOT / "data" / "classification-mapping.json"
EFFECTOR_UNIPROT_MAPPING_PATH = ROOT / "data" / "sources" / "effector_uniprot_mapping.json"
EFFECTOR_ID_REGISTRY_PATH = ROOT / "data" / "sources" / "effector_ids.json"
REFERENCE_ID_REGISTRY_PATH = ROOT / "data" / "sources" / "reference_ids.json"
HOST_TARGET_ID_REGISTRY_PATH = ROOT / "data" / "sources" / "host_target_ids.json"
DERIVED_FEATURES_PATH = ROOT / "data" / "derived" / "effector_features.json"
CACHE_ROOT = ROOT / "data" / "sources"
DB_PATH = ROOT / "data" / "pathomap.db"
SQL_PATH = ROOT / "data" / "schema.sql"

SCHEMA_VERSION = "2.2"
DATASET_NAME = "pathomap"

# Amino acid sequences are standard IUPAC one-letter codes (including the
# ambiguity codes B/Z/J/X and rare U/O) plus a stop codon
SEQUENCE_PATTERN = re.compile(r"^[ACDEFGHIKLMNPQRSTVWYBZJXUO*]+$")

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


def utc_now() -> str:
    return (
        dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


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


def read_classification_mapping(mapping_path: Path) -> dict[str, dict[str, str]]:
    """Read classification mapping JSON file."""
    return read_json(mapping_path)


def apply_classifications(effectors: list[dict], mapping: dict[str, dict[str, str]]) -> list[dict]:
    """Apply classification mappings to effector records."""
    host_target_mapping = mapping.get("host_target_classifications", {})
    type_mapping = mapping.get("type_classifications", {})
    mechanism_mapping = mapping.get("mechanism_classifications", {})

    for effector in effectors:
        # Apply host_target classification
        host_target = effector.get("host_target", "")
        effector["host_target_class"] = host_target_mapping.get(host_target, "")

        # Apply type classification
        effector_type = effector.get("type", "")
        effector["type_class"] = type_mapping.get(effector_type, "")

        # Apply mechanism classification
        mechanism = effector.get("mechanism", "")
        effector["mechanism_class"] = mechanism_mapping.get(mechanism, "")

        # effector_name_class is currently empty (no mapping provided)
        effector["effector_name_class"] = ""

    return effectors


AUDIT_STATUSES = {
    "verified_protein",
    "verified_protein_family",
    "verified_complex",
    "ambiguous",
    "non_protein",
    "unresolved",
}
RESOLUTION_BY_AUDIT_STATUS = {
    "verified_protein": "resolved_protein",
    "verified_protein_family": "protein_family",
    "verified_complex": "protein_complex",
    "ambiguous": "ambiguous",
    "non_protein": "non_protein",
    "unresolved": "unresolved",
}
HOST_TARGET_RESOLUTION_VALUES = set(RESOLUTION_BY_AUDIT_STATUS.values())


def load_host_target_audit() -> dict[str, dict]:
    """Load the curated host-target audit, keyed by original annotation."""
    if not HOST_TARGET_AUDIT_PATH.exists():
        raise BuildError(f"missing host-target audit {HOST_TARGET_AUDIT_PATH}")
    payload = read_json(HOST_TARGET_AUDIT_PATH)
    entries = payload.get("targets")
    if not isinstance(entries, list):
        raise BuildError("host-target audit must contain a targets list")
    audit: dict[str, dict] = {}
    for entry in entries:
        name = entry.get("original_target")
        if not isinstance(name, str) or not name.strip():
            raise BuildError("host-target audit entry is missing original_target")
        if name in audit:
            raise BuildError(f"duplicate host-target audit entry {name!r}")
        audit[name] = entry
    return audit


def assign_entity_identifiers(
    effectors: list[dict],
    host_proteins: list[dict],
    pathogens: dict[str, dict],
) -> tuple[list[dict], list[dict], list[dict], dict[str, str], dict[str, str]]:
    """Attach stable entity IDs and resolve cross-table references.

    Effector -> pathogen is linked by ``pathogen_id``. Each distinct
    ``host_target`` becomes a ``host_targets`` row; it links to a curated host
    protein only on an exact, case-insensitive match of the target to a host
    protein's name, gene symbol or UniProt accession.
    """
    host_target_lookup: dict[str, int] = {}
    protein_by_uniprot: dict[str, dict] = {}
    for protein in host_proteins:
        host_protein_id = int(protein["host_protein_id"])
        protein["entity_id"] = entity_id("host_protein", host_protein_id)
        uniprot = str(protein.get("uniprot_id") or "").strip().upper()
        if uniprot:
            protein_by_uniprot[uniprot] = protein
        for candidate in ("protein_name", "gene_name", "uniprot_id"):
            value = protein.get(candidate)
            if isinstance(value, str) and value.strip():
                host_target_lookup.setdefault(value.strip().lower(), host_protein_id)

    audit = load_host_target_audit()

    # Collect distinct targets while checking for classification conflicts.
    target_info: dict[str, dict] = {}
    for effector in effectors:
        name = (effector.get("host_target") or "").strip()
        if not name:
            raise BuildError(f"effector {effector.get('effector_name')!r} has no host_target")
        key = host_target_key(name)
        host_target_class = effector.get("host_target_class") or ""
        existing = target_info.get(key)
        if existing is None:
            target_info[key] = {"name": name, "host_target_class": host_target_class}
        elif existing["host_target_class"] != host_target_class:
            raise BuildError(
                f"host target {name!r} has conflicting classes "
                f"{existing['host_target_class']!r} and {host_target_class!r}"
            )

    target_registry = load_registry(HOST_TARGET_ID_REGISTRY_PATH, "host_targets")
    target_errors = validate_registry(target_registry, "host_target")
    if target_errors:
        raise BuildError("; ".join(target_errors))
    target_registry = assign_registry_ids(sorted(target_info), target_registry, "host_target")

    target_ids: dict[str, int] = {}
    host_targets: list[dict] = []
    for key, info in target_info.items():
        eid = target_registry[key]
        target_id = int(eid.rsplit("-", 1)[1])
        target_ids[key] = target_id

        audit_entry = audit.get(info["name"])
        if audit_entry is None:
            raise BuildError(f"host target {info['name']!r} has no audit entry")
        if audit_entry.get("original_class") != info["host_target_class"]:
            raise BuildError(
                f"audit class for {info['name']!r} is "
                f"{audit_entry.get('original_class')!r}, expected "
                f"{info['host_target_class']!r}"
            )
        audit_status = audit_entry.get("audit_status")
        if audit_status not in AUDIT_STATUSES:
            raise BuildError(
                f"host target {info['name']!r} has invalid audit_status {audit_status!r}"
            )

        host_protein_id = None
        if audit_status == "verified_protein":
            uniprot = str(audit_entry.get("uniprot_id") or "").strip().upper()
            protein = protein_by_uniprot.get(uniprot)
            if protein is None:
                host_protein_id = host_target_lookup.get(info["name"].strip().lower())
            else:
                host_protein_id = int(protein["host_protein_id"])
            if host_protein_id is None:
                raise BuildError(
                    f"verified protein target {info['name']!r} ({uniprot}) "
                    "has no host_proteins row"
                )

        host_targets.append(
            {
                "entity_id": eid,
                "host_target_id": target_id,
                "name": info["name"],
                "host_target_class": info["host_target_class"],
                "host_protein_id": host_protein_id,
                "resolution_status": RESOLUTION_BY_AUDIT_STATUS[audit_status],
                "audit_status": audit_status,
                "resolved_name": audit_entry.get("resolved_name"),
                "gene_symbol": audit_entry.get("gene_symbol"),
                "uniprot_id": audit_entry.get("uniprot_id"),
                "aliases": audit_entry.get("aliases", []),
                "members": audit_entry.get("members", []),
                "evidence_sources": audit_entry.get("evidence_sources", []),
                "audit_notes": audit_entry.get("notes"),
            }
        )
    host_targets.sort(key=lambda row: row["host_target_id"])

    for effector in effectors:
        pathogen = pathogens[effector["pathogen_name"]]
        effector["pathogen_id"] = int(pathogen["pathogen_id"])
        key = host_target_key(effector["host_target"])
        effector["host_target_id"] = target_ids[key]
        # Host-protein links live on host_targets; curated effector references
        # are empty until per-effector evidence is added.
        effector.pop("host_protein_id", None)
        effector["reference_ids"] = []

    registry = load_effector_registry(EFFECTOR_ID_REGISTRY_PATH)
    registry_errors = validate_effector_registry(registry)
    if registry_errors:
        raise BuildError("; ".join(registry_errors))

    assigned, registry = assign_effector_ids(effectors, registry)
    for index, effector in enumerate(effectors):
        effector["entity_id"] = assigned[index]

    return effectors, host_proteins, host_targets, registry, target_registry


def assign_dataset_references(
    pathogens: list[dict], host_proteins: list[dict]
) -> tuple[list[dict], dict[str, str]]:
    """Assign stable reference IDs to pathogen and host-protein rows."""
    registry = load_registry(REFERENCE_ID_REGISTRY_PATH, "references")
    registry_errors = validate_registry(registry, "reference")
    if registry_errors:
        raise BuildError("; ".join(registry_errors))

    rows = [*pathogens, *host_proteins]
    doi_display: dict[str, str] = {}
    for row in rows:
        doi = row.get("reference_doi")
        if isinstance(doi, str) and doi.strip():
            doi_display.setdefault(reference_key(doi), doi.strip())

    registry = assign_registry_ids(sorted(doi_display), registry, "reference")
    for row in rows:
        doi = row.get("reference_doi")
        key = reference_key(doi) if isinstance(doi, str) and doi.strip() else None
        row["reference_ids"] = [registry[key]] if key else []

    references = [
        {
            "entity_id": registry[key],
            "doi": doi_display[key],
            "url": f"https://doi.org/{doi_display[key]}",
        }
        for key in doi_display
    ]
    references.sort(key=lambda row: int(row["entity_id"].rsplit("-", 1)[1]))
    return references, registry


def references_for_rows(rows: list[dict], references: list[dict]) -> list[dict]:
    """Select the reference rows used by a subset of dataset rows."""
    used = {ref_id for row in rows for ref_id in row.get("reference_ids", [])}
    return [ref for ref in references if ref["entity_id"] in used]


def validate_references(rows: list[dict], references: list[dict]) -> list[str]:
    """Validate reference rows and per-row reference links."""
    errors: list[str] = []
    seen_ids: set[str] = set()
    seen_dois: set[str] = set()
    for index, ref in enumerate(references):
        label = f"reference row {index} ({ref.get('entity_id', '?')})"
        eid = ref.get("entity_id")
        if not is_entity_id(eid, "reference"):
            errors.append(f"{label}: invalid reference entity_id {eid!r}")
        elif eid in seen_ids:
            errors.append(f"{label}: duplicate entity_id {eid}")
        else:
            seen_ids.add(eid)
        doi = ref.get("doi")
        if not isinstance(doi, str) or not doi.startswith("10."):
            errors.append(f"{label}: doi must start with 10.")
            continue
        key = reference_key(doi)
        if key in seen_dois:
            errors.append(f"{label}: duplicate DOI {doi!r}")
        else:
            seen_dois.add(key)
        if ref.get("url") != f"https://doi.org/{doi}":
            errors.append(f"{label}: url must be https://doi.org/<doi>")

    for index, row in enumerate(rows):
        label = f"reference link row {index}"
        ref_ids = row.get("reference_ids")
        if not isinstance(ref_ids, list):
            errors.append(f"{label}: reference_ids must be a list")
            continue
        if len(set(ref_ids)) != len(ref_ids):
            errors.append(f"{label}: reference_ids contains duplicates")
        for ref_id in ref_ids:
            if not is_entity_id(ref_id, "reference"):
                errors.append(f"{label}: invalid reference ID {ref_id!r}")
            elif ref_id not in seen_ids:
                errors.append(f"{label}: unknown reference ID {ref_id}")
        doi = row.get("reference_doi")
        if isinstance(doi, str) and doi.strip():
            expected = [
                ref["entity_id"]
                for ref in references
                if reference_key(ref["doi"]) == reference_key(doi)
            ]
            if expected and ref_ids != expected:
                errors.append(f"{label}: reference_ids do not match reference_doi")
    return errors


def validate_effectors(
    effectors: list[dict],
    pathogen_ids: set[int] | None = None,
    host_target_ids: set[int] | None = None,
) -> list[str]:
    """Validate effector records, stable IDs and foreign keys."""
    errors: list[str] = []
    seen: set[tuple] = set()
    seen_entity_ids: set[str] = set()

    for index, row in enumerate(effectors):
        label = f"row {index}"

        # Check required fields
        required = [
            "entity_id",
            "effector_name",
            "pathogen_id",
            "pathogen_name",
            "type",
            "host_target",
            "mechanism",
        ]
        for key in required:
            value = row.get(key)
            if value is None or (isinstance(value, str) and not value.strip()):
                errors.append(f"{label}: missing required field {key}")

        # Canonical entity ID must be valid and unique
        eid = row.get("entity_id")
        if not isinstance(eid, str) or not re.fullmatch(r"PM-EFF-\d{4,}", eid):
            errors.append(f"{label}: invalid effector entity_id {eid!r}")
        elif eid in seen_entity_ids:
            errors.append(f"{label}: duplicate entity_id {eid}")
        else:
            seen_entity_ids.add(eid)

        # Foreign keys resolve to existing rows
        pathogen_id = row.get("pathogen_id")
        if not isinstance(pathogen_id, int) or pathogen_id <= 0:
            errors.append(f"{label}: pathogen_id must be a positive integer")
        elif pathogen_ids is not None and pathogen_id not in pathogen_ids:
            errors.append(f"{label}: unknown pathogen_id {pathogen_id}")
        host_target_id = row.get("host_target_id")
        if not isinstance(host_target_id, int) or host_target_id <= 0:
            errors.append(f"{label}: host_target_id must be a positive integer")
        elif host_target_ids is not None and host_target_id not in host_target_ids:
            errors.append(f"{label}: unknown host_target_id {host_target_id}")

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
    seen_entity_ids: set[str] = set()
    seen_uniprot: set[str] = set()

    for index, row in enumerate(host_proteins):
        label = f"row {index} ({row.get('protein_name', '?')})"

        # Check required fields
        required = [
            "entity_id",
            "host_protein_id",
            "protein_name",
            "gene_name",
            "uniprot_id",
            "localization",
            "function",
            "last_updated",
        ]
        for key in required:
            value = row.get(key)
            if value is None or (isinstance(value, str) and not value.strip()):
                errors.append(f"{label}: missing required field {key}")

        # Check canonical entity ID
        eid = row.get("entity_id")
        if not isinstance(eid, str) or not re.fullmatch(r"PM-HST-\d{4,}", eid):
            errors.append(f"{label}: invalid host protein entity_id {eid!r}")
        elif eid in seen_entity_ids:
            errors.append(f"{label}: duplicate entity_id {eid}")
        else:
            seen_entity_ids.add(eid)

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


def validate_host_targets(
    host_targets: list[dict], host_protein_ids: set[int]
) -> list[str]:
    """Validate host-target identity, classification and resolution links."""
    errors: list[str] = []
    seen_ids: set[int] = set()
    seen_entity_ids: set[str] = set()
    seen_names: set[str] = set()

    for index, row in enumerate(host_targets):
        label = f"host_target row {index} ({row.get('name', '?')})"
        for key in ("entity_id", "host_target_id", "name", "host_target_class", "resolution_status"):
            value = row.get(key)
            if value is None or (isinstance(value, str) and not value.strip()):
                errors.append(f"{label}: missing required field {key}")

        eid = row.get("entity_id")
        if not is_entity_id(eid, "host_target"):
            errors.append(f"{label}: invalid host_target entity_id {eid!r}")
        elif eid in seen_entity_ids:
            errors.append(f"{label}: duplicate entity_id {eid}")
        else:
            seen_entity_ids.add(eid)

        target_id = row.get("host_target_id")
        if not isinstance(target_id, int) or target_id <= 0:
            errors.append(f"{label}: host_target_id must be a positive integer")
        elif target_id in seen_ids:
            errors.append(f"{label}: duplicate host_target_id {target_id}")
        else:
            seen_ids.add(target_id)
        if is_entity_id(eid, "host_target") and isinstance(target_id, int):
            if int(eid.rsplit("-", 1)[1]) != target_id:
                errors.append(f"{label}: entity_id does not match host_target_id")

        name = row.get("name")
        if isinstance(name, str):
            key = host_target_key(name)
            if key in seen_names:
                errors.append(f"{label}: duplicate normalized name {name!r}")
            seen_names.add(key)

        host_protein_id = row.get("host_protein_id")
        if host_protein_id is not None:
            if not isinstance(host_protein_id, int) or host_protein_id <= 0:
                errors.append(f"{label}: host_protein_id must be a positive integer or null")
            elif host_protein_id not in host_protein_ids:
                errors.append(f"{label}: unknown host_protein_id {host_protein_id}")

        audit_status = row.get("audit_status")
        if audit_status not in AUDIT_STATUSES:
            errors.append(f"{label}: invalid audit_status {audit_status!r}")
        else:
            expected = RESOLUTION_BY_AUDIT_STATUS[audit_status]
            status = row.get("resolution_status")
            if status not in HOST_TARGET_RESOLUTION_VALUES:
                errors.append(f"{label}: invalid resolution_status {status!r}")
            elif status != expected:
                errors.append(
                    f"{label}: resolution_status {status!r} should be {expected!r}"
                )
            if audit_status == "verified_protein":
                if host_protein_id is None:
                    errors.append(f"{label}: verified_protein needs host_protein_id")
                for key in ("resolved_name", "gene_symbol", "uniprot_id"):
                    if not row.get(key):
                        errors.append(f"{label}: verified_protein needs {key}")
            else:
                if host_protein_id is not None:
                    errors.append(
                        f"{label}: {audit_status} must not link host_protein_id"
                    )
                if audit_status in ("verified_protein_family", "verified_complex"):
                    if not row.get("members"):
                        errors.append(f"{label}: {audit_status} needs members")
                if audit_status == "non_protein" and row.get("uniprot_id"):
                    errors.append(f"{label}: non_protein must not have uniprot_id")

        for key in ("aliases", "members", "evidence_sources"):
            value = row.get(key)
            if not isinstance(value, list):
                errors.append(f"{label}: {key} must be a list")
        for member in row.get("members") or []:
            if not isinstance(member, dict):
                errors.append(f"{label}: each member must be an object")
                continue
            for key in ("name", "gene_symbol", "uniprot_id"):
                if not member.get(key):
                    errors.append(f"{label}: member missing {key}")
        if not row.get("evidence_sources"):
            errors.append(f"{label}: needs at least one evidence source")

    return errors


# ---------------------------------------------------------------------------
# Molecular feature calculations (Biopython-style, no external dependencies)
# ---------------------------------------------------------------------------

# Amino acid residue molecular weights (Da)
AA_MW = {
    'A': 89.09, 'R': 174.20, 'N': 132.12, 'D': 133.10, 'C': 121.16,
    'E': 147.13, 'Q': 146.15, 'G': 75.07, 'H': 155.16, 'I': 131.18,
    'L': 131.18, 'K': 146.19, 'M': 149.21, 'F': 165.19, 'P': 115.13,
    'S': 105.09, 'T': 119.12, 'W': 204.23, 'Y': 181.19, 'V': 117.15,
}

# Kyte-Doolittle hydropathy values (GRAVY inputs)
AA_GRAVY = {
    'A': 1.8, 'R': -4.5, 'N': -3.5, 'D': -3.5, 'C': 2.5,
    'E': -3.5, 'Q': -3.5, 'G': -0.4, 'H': -3.2, 'I': 4.5,
    'L': 3.8, 'K': -3.9, 'M': 1.9, 'F': 2.8, 'P': -1.6,
    'S': -0.8, 'T': -0.7, 'W': -0.9, 'Y': -1.3, 'V': 4.2,
}

# pKa values for pI calculation (EMBOSS scale)
PKA_NTERM = 8.6
PKA_CTERM = 3.6
PKA_SIDE_CHAINS = {
    'D': 3.65, 'E': 4.25, 'C': 8.5, 'Y': 10.0,
    'H': 6.5, 'K': 10.8, 'R': 12.4,
}


def clean_sequence(sequence: str) -> str:
    """Strip whitespace/stop codons and uppercase an amino acid sequence."""
    return "".join(ch for ch in sequence.upper() if ch.isalpha())


def calculate_molecular_weight(sequence: str) -> float:
    """Calculate molecular weight in Daltons (sum of residues minus water)."""
    residues = [aa for aa in sequence if aa in AA_MW]
    if not residues:
        return 0.0
    return sum(AA_MW[aa] for aa in residues) - (len(residues) - 1) * 18.015


def _net_charge(sequence: str, ph: float) -> float:
    """Net charge of a peptide at a given pH (Henderson-Hasselbalch)."""
    positive = 1.0 / (1.0 + 10 ** (ph - PKA_NTERM))  # N-terminus
    positive += sum(
        1.0 / (1.0 + 10 ** (ph - PKA_SIDE_CHAINS[aa]))
        for aa in sequence if aa in ('K', 'R', 'H')
    )
    negative = 1.0 / (1.0 + 10 ** (PKA_CTERM - ph))  # C-terminus
    negative += sum(
        1.0 / (1.0 + 10 ** (PKA_SIDE_CHAINS[aa] - ph))
        for aa in sequence if aa in ('D', 'E', 'C', 'Y')
    )
    return positive - negative


def calculate_isoelectric_point(sequence: str) -> float:
    """Calculate the isoelectric point (pI) by bisection on net charge."""
    if not sequence:
        return 0.0
    low, high = 0.0, 14.0
    for _ in range(100):
        mid = (low + high) / 2.0
        if _net_charge(sequence, mid) > 0:
            low = mid
        else:
            high = mid
    return round((low + high) / 2.0, 2)


def calculate_gravy(sequence: str) -> float:
    """Calculate grand average of hydropathy (GRAVY)."""
    values = [AA_GRAVY[aa] for aa in sequence if aa in AA_GRAVY]
    if not values:
        return 0.0
    return sum(values) / len(values)


def calculate_molecular_features(sequence: str) -> dict:
    """Calculate molecular weight, pI, and GRAVY for a sequence."""
    if not sequence:
        return {
            "molecular_weight_da": None,
            "isoelectric_point": None,
            "gravy_score": None,
        }
    return {
        "molecular_weight_da": round(calculate_molecular_weight(sequence), 2),
        "isoelectric_point": calculate_isoelectric_point(sequence),
        "gravy_score": round(calculate_gravy(sequence), 3),
    }


# ---------------------------------------------------------------------------
# API enrichment
# ---------------------------------------------------------------------------

def _domains_from_apis(uniprot_id: str, args: argparse.Namespace) -> list[dict]:
    """Fall back to InterPro, then Pfam, when UniProt has no domain features."""
    for fetcher in (fetch_interpro_domains, fetch_pfam_domains):
        try:
            domains = fetcher(uniprot_id, CACHE_ROOT, args)
        except ApiError as exc:
            print(f"warning: {fetcher.__name__} failed for {uniprot_id}: {exc}", file=sys.stderr)
            continue
        if domains:
            return domains
    return []


def apply_uniprot_enrichment(
    record: dict, entry: dict, args: argparse.Namespace, *, with_pathways: bool = False
) -> dict:
    """Apply sequence, molecular features, domains, and GO terms from a UniProt entry."""
    sequence = clean_sequence(extract_sequence(entry))
    record["sequence"] = sequence or None
    record["sequence_length"] = len(sequence) if sequence else None
    record.update(calculate_molecular_features(sequence))

    # Domain priority: UniProt features (with coordinates) -> InterPro/Pfam
    # APIs (with coordinates) -> UniProt cross-references (no coordinates)
    domains = extract_domains(entry, include_cross_refs=False)
    if not domains and sequence:
        domains = _domains_from_apis(record.get("uniprot_id", ""), args)
    if not domains:
        domains = extract_domains(entry)
    record["domains"] = domains
    record["go_terms"] = extract_go_terms(entry)

    if with_pathways:
        record["pathways_detailed"] = extract_pathways(entry)
    return record


def enrich_host_protein(protein: dict, args: argparse.Namespace) -> dict:
    """Enrich a host protein with UniProt sequence/annotation data."""
    uniprot_id = protein.get("uniprot_id")
    if not uniprot_id:
        print(
            f"warning: host protein {protein.get('protein_name', '?')} has no uniprot_id",
            file=sys.stderr,
        )
        return protein

    try:
        entry = fetch_uniprot_entry(uniprot_id, CACHE_ROOT, args)
    except ApiError as exc:
        print(
            f"warning: UniProt fetch failed for {uniprot_id} "
            f"({protein.get('gene_name', '?')}): {exc}",
            file=sys.stderr,
        )
        return protein

    apply_uniprot_enrichment(protein, entry, args, with_pathways=True)

    # Protein-protein interactions from STRING (optional, degrade gracefully)
    try:
        protein["interacting_partners"] = fetch_string_interactions(
            uniprot_id, CACHE_ROOT, args
        )
    except ApiError as exc:
        print(f"warning: STRING fetch failed for {uniprot_id}: {exc}", file=sys.stderr)
        protein["interacting_partners"] = []

    return protein


def _organism_matches(organism: str, pathogen_name: str) -> bool:
    """Check whether a UniProt organism name is compatible with the pathogen.

    Requires a genus (first word) match plus at least one other shared token
    (species/serovar/strain), so old and new nomenclature still line up
    (e.g. "Salmonella typhimurium" vs "Salmonella enterica serovar Typhimurium").
    """
    if not organism or not pathogen_name:
        return False
    organism_tokens = set(organism.lower().split())
    pathogen_tokens = pathogen_name.lower().split()
    if pathogen_tokens[0] not in organism_tokens:
        return False
    if len(pathogen_tokens) == 1:
        return True
    return any(token in organism_tokens for token in pathogen_tokens[1:])


def resolve_effector_uniprot_id(
    effector: dict, mapping: dict[str, str], args: argparse.Namespace
) -> tuple[str | None, dict | None]:
    """Resolve an effector to a UniProt accession + entry.

    Prefers the curated mapping file (keys are ``"Effector"`` or
    ``"Effector|Pathogen name"`` for effector names shared across pathogens),
    then falls back to a UniProt search by effector name + pathogen name
    (keeping only organism-matching hits).
    """
    name = effector.get("effector_name", "")
    pathogen_name = effector.get("pathogen_name", "")
    uniprot_id = mapping.get(f"{name}|{pathogen_name}") or mapping.get(name)

    if uniprot_id:
        try:
            return uniprot_id, fetch_uniprot_entry(uniprot_id, CACHE_ROOT, args)
        except ApiError as exc:
            print(f"warning: mapped UniProt ID {uniprot_id} for {name} failed: {exc}", file=sys.stderr)

    try:
        candidates = search_uniprot(name, pathogen_name, CACHE_ROOT, args)
    except ApiError as exc:
        print(f"warning: UniProt search failed for {name!r}: {exc}", file=sys.stderr)
        return None, None

    for candidate in candidates:
        try:
            entry = fetch_uniprot_entry(candidate, CACHE_ROOT, args)
        except ApiError:
            continue
        organism = (entry.get("organism") or {}).get("scientificName", "")
        if not organism or _organism_matches(organism, pathogen_name):
            return candidate, entry

    print(
        f"warning: no organism-matching UniProt entry for effector {name!r} "
        f"({pathogen_name})",
        file=sys.stderr,
    )
    return None, None


def enrich_effector(
    effector: dict, mapping: dict[str, str], args: argparse.Namespace
) -> dict:
    """Enrich an effector with UniProt data (mapping file, then search fallback)."""
    uniprot_id, entry = resolve_effector_uniprot_id(effector, mapping, args)
    if not uniprot_id or entry is None:
        return effector
    effector["uniprot_id"] = uniprot_id
    apply_uniprot_enrichment(effector, entry, args)
    effector["signal_peptide"] = extract_signal_peptide(entry)
    effector["transmembrane_regions"] = extract_transmembrane_regions(entry)
    return effector


def enrich_records(effectors: list[dict], host_proteins: list[dict], args: argparse.Namespace) -> tuple[list[dict], list[dict]]:
    """Run API enrichment over host proteins (always) and effectors (optional)."""
    cache_missing = not any(
        (CACHE_ROOT / "uniprot" / "entries").glob("*.json")
    ) if (CACHE_ROOT / "uniprot" / "entries").exists() else True

    if args.no_network and cache_missing:
        print(
            "warning: --no-network set but no UniProt cache found; skipping enrichment",
            file=sys.stderr,
        )
        return effectors, host_proteins

    host_proteins = [enrich_host_protein(protein, args) for protein in host_proteins]

    if args.enrich_effectors:
        mapping = read_json(EFFECTOR_UNIPROT_MAPPING_PATH) if EFFECTOR_UNIPROT_MAPPING_PATH.exists() else {}
        effectors = [enrich_effector(effector, mapping, args) for effector in effectors]
    return effectors, host_proteins


def validate_enriched_records(effectors: list[dict], host_proteins: list[dict]) -> list[str]:
    """Validate enrichment fields (sequence format, feature types)."""
    errors: list[str] = []

    for index, row in enumerate(effectors):
        label = f"effector row {index} ({row.get('effector_name', '?')})"
        errors.extend(_validate_sequence_fields(label, row))

    for index, row in enumerate(host_proteins):
        label = f"host_protein row {index} ({row.get('protein_name', '?')})"
        errors.extend(_validate_sequence_fields(label, row))
        for key in ("pathways_detailed", "interacting_partners", "domains", "go_terms"):
            if row.get(key) is not None and not isinstance(row.get(key), list):
                errors.append(f"{label}: {key} must be a list")

    return errors


def _validate_sequence_fields(label: str, row: dict) -> list[str]:
    errors: list[str] = []
    sequence = row.get("sequence")
    if sequence is not None:
        if not isinstance(sequence, str) or not SEQUENCE_PATTERN.match(sequence):
            errors.append(f"{label}: invalid sequence characters")
        length = row.get("sequence_length")
        if length is not None and length != len(sequence):
            errors.append(f"{label}: sequence_length does not match sequence")
    for key in ("molecular_weight_da", "isoelectric_point", "gravy_score"):
        value = row.get(key)
        if value is not None and not isinstance(value, (int, float)):
            errors.append(f"{label}: {key} must be numeric")
    domains = row.get("domains")
    if domains is not None and not isinstance(domains, list):
        errors.append(f"{label}: domains must be a list")
    return errors


EFFECTOR_DERIVED_FIELDS = [
    "sequence_length",
    "molecular_weight_da",
    "isoelectric_point",
    "gravy_score",
]


def build_derived_features(
    effectors: list[dict], source_built_at: str
) -> dict:
    """Build the derived effector feature matrix (one row per effector)."""
    features = []
    for effector in sorted(
        effectors, key=lambda row: int(row["entity_id"].rsplit("-", 1)[1])
    ):
        values = {field: effector.get(field) for field in EFFECTOR_DERIVED_FIELDS}
        if not effector.get("sequence"):
            status = "missing_sequence"
        elif all(value is not None for value in values.values()):
            status = "computed"
        else:
            status = "incomplete"
        features.append(
            {
                "entity_id": effector["entity_id"],
                **values,
                "feature_status": status,
            }
        )

    return {
        "meta": {
            "dataset": DATASET_NAME,
            "table": "effector_features",
            "schema_version": SCHEMA_VERSION,
            "generated_at": source_built_at,
            "source_table": "effectors",
            "source_row_count": len(effectors),
            "feature_count": len(features),
            "methods": {
                "sequence_length": "len(sequence)",
                "molecular_weight_da": "sum of residue masses minus water",
                "isoelectric_point": "Henderson-Hasselbalch bisection",
                "gravy_score": "Kyte-Doolittle mean",
            },
            "notes": (
                "Computed features only; they are not curated annotations. "
                "Rows with no sequence are reported explicitly as missing_sequence."
            ),
        },
        "features": features,
    }


def validate_derived_features(
    effectors: list[dict], payload: dict
) -> list[str]:
    """Validate the derived feature matrix against effector sequences."""
    errors: list[str] = []
    features = payload.get("features")
    if not isinstance(features, list):
        return ["derived features payload must contain a features list"]

    by_id = {row.get("entity_id"): row for row in effectors}
    seen: set[str] = set()
    for index, row in enumerate(features):
        label = f"derived row {index} ({row.get('entity_id', '?')})"
        eid = row.get("entity_id")
        if not is_entity_id(eid, "effector"):
            errors.append(f"{label}: invalid effector entity_id {eid!r}")
            continue
        if eid in seen:
            errors.append(f"{label}: duplicate entity_id {eid}")
        seen.add(eid)
        effector = by_id.get(eid)
        if effector is None:
            errors.append(f"{label}: unknown effector entity_id")
            continue

        for field in EFFECTOR_DERIVED_FIELDS:
            value = row.get(field)
            if value is not None and not isinstance(value, (int, float)):
                errors.append(f"{label}: {field} must be numeric or null")
        sequence = effector.get("sequence")
        if sequence:
            length = row.get("sequence_length")
            if length != len(sequence):
                errors.append(f"{label}: sequence_length does not match sequence")
            if row.get("feature_status") not in ("computed", "incomplete"):
                errors.append(f"{label}: sequence present but feature_status is not computed")
        else:
            if any(row.get(field) is not None for field in EFFECTOR_DERIVED_FIELDS):
                errors.append(f"{label}: missing sequence must have null computed features")
            if row.get("feature_status") != "missing_sequence":
                errors.append(f"{label}: missing sequence needs feature_status=missing_sequence")

    missing = set(by_id) - seen
    if missing:
        errors.append(f"derived features missing {len(missing)} effector rows")
    return errors


def build_tables(
    args: argparse.Namespace,
) -> tuple[
    list[dict],
    list[dict],
    list[dict],
    list[dict],
    dict[str, str],
    dict[str, str],
    dict[str, str],
]:
    """Build effectors, host_proteins, host_targets and references tables."""
    # Read seed files
    if not EFFECTORS_SEED_PATH.exists():
        raise BuildError(f"missing seed file {EFFECTORS_SEED_PATH}")
    if not HOST_PROTEINS_SEED_PATH.exists():
        raise BuildError(f"missing seed file {HOST_PROTEINS_SEED_PATH}")

    effectors = read_json(EFFECTORS_SEED_PATH)
    host_proteins = read_json(HOST_PROTEINS_SEED_PATH)
    if HOST_PROTEINS_AUDIT_SEED_PATH.exists():
        audit_seed = read_json(HOST_PROTEINS_AUDIT_SEED_PATH)
        host_proteins.extend(
            audit_seed if isinstance(audit_seed, list) else audit_seed.get("host_proteins", [])
        )
    for protein in host_proteins:
        if not protein.get("evidence_source"):
            doi = protein.get("reference_doi")
            protein["evidence_source"] = (
                f"https://doi.org/{doi}" if isinstance(doi, str) and doi else None
            )

    # Read classification mapping
    if not CLASSIFICATION_MAPPING_PATH.exists():
        raise BuildError(f"missing classification mapping {CLASSIFICATION_MAPPING_PATH}")
    classification_mapping = read_classification_mapping(CLASSIFICATION_MAPPING_PATH)

    # Apply classifications to effectors
    effectors = apply_classifications(effectors, classification_mapping)

    # Read pathogens to validate pathogen_name references
    pathogen_rows = read_json(PATHOGENS_DATASET_PATH).get("pathogens", [])
    pathogens = {row["name"]: row for row in pathogen_rows}

    # Validate that all pathogen_name references exist in pathogens table
    for effector in effectors:
        pathogen_name = effector.get("pathogen_name")
        if pathogen_name not in pathogens:
            raise BuildError(
                f"effector references unknown pathogen {pathogen_name!r}"
            )

    # Attach stable entity IDs and resolve pathogen/host-target foreign keys
    effectors, host_proteins, host_targets, effector_registry, target_registry = (
        assign_entity_identifiers(effectors, host_proteins, pathogens)
    )

    # Enrich with external API data (UniProt/InterPro/Pfam/STRING)
    effectors, host_proteins = enrich_records(effectors, host_proteins, args)

    # References come after enrichment so host-protein DOIs are included.
    references, reference_registry = assign_dataset_references(
        pathogen_rows, host_proteins
    )

    return (
        effectors,
        host_proteins,
        host_targets,
        references,
        effector_registry,
        target_registry,
        reference_registry,
    )


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
    host_targets: list[dict],
    references: list[dict],
    built_at: str,
) -> dict:
    """Update the dataset file with the generated primary tables."""
    dataset = read_json(dataset_path)

    # Update meta
    dataset["meta"]["tables"]["effectors"] = len(effectors)
    dataset["meta"]["tables"]["host_proteins"] = len(host_proteins)
    dataset["meta"]["tables"]["host_targets"] = len(host_targets)
    dataset["meta"]["tables"]["references"] = len(references)
    dataset["meta"]["built_at"] = built_at
    dataset["meta"]["derived"] = {
        "effector_features": DERIVED_FEATURES_PATH.relative_to(ROOT).as_posix()
    }

    # Record enrichment sources when API data is present
    if any(row.get("sequence") for row in host_proteins) or any(
        row.get("sequence") for row in effectors
    ):
        sources = dataset["meta"].setdefault("sources", {})
        sources.setdefault("uniprot", "https://rest.uniprot.org/")
        sources.setdefault("interpro", "https://www.ebi.ac.uk/interpro/")
        sources.setdefault("string", "https://string-db.org/")

    # Project rows so computed features stay in data/derived/effector_features.json
    dataset["effectors"] = [
        {column: row.get(column) for column in EFFECTOR_COLUMNS}
        for row in effectors
    ]
    dataset["host_proteins"] = [
        {column: row.get(column) for column in HOST_PROTEIN_COLUMNS}
        for row in host_proteins
    ]
    dataset["host_targets"] = [
        {column: row.get(column) for column in HOST_TARGET_COLUMNS}
        for row in host_targets
    ]
    dataset["references"] = references

    return dataset


EFFECTOR_COLUMNS = [
    "entity_id",
    "effector_name",
    "effector_name_class",
    "pathogen_id",
    "pathogen_name",
    "host_target_id",
    "host_target",
    "host_target_class",
    "type",
    "type_class",
    "mechanism",
    "mechanism_class",
    "uniprot_id",
    "sequence",
    "domains",
    "go_terms",
    "signal_peptide",
    "transmembrane_regions",
    "reference_ids",
]

HOST_PROTEIN_COLUMNS = [
    "entity_id",
    "host_protein_id",
    "protein_name",
    "gene_name",
    "uniprot_id",
    "sequence",
    "sequence_length",
    "molecular_weight_da",
    "isoelectric_point",
    "gravy_score",
    "domains",
    "go_terms",
    "localization",
    "function",
    "pathway",
    "pathways_detailed",
    "interacting_partners",
    "reference_doi",
    "reference_ids",
    "evidence_source",
    "last_updated",
]

HOST_TARGET_COLUMNS = [
    "entity_id",
    "host_target_id",
    "name",
    "host_target_class",
    "host_protein_id",
    "resolution_status",
    "audit_status",
    "resolved_name",
    "gene_symbol",
    "uniprot_id",
    "aliases",
    "members",
    "evidence_sources",
    "audit_notes",
]

REFERENCE_COLUMNS = [
    "entity_id",
    "doi",
    "url",
]

# Array fields are stored in link tables, not as JSON columns.
EFFECTOR_SQL_COLUMNS = [col for col in EFFECTOR_COLUMNS if col != "reference_ids"]
HOST_PROTEIN_SQL_COLUMNS = [
    col for col in HOST_PROTEIN_COLUMNS if col != "reference_ids"
]

# SQLite column types for enrichment fields (array/object fields store JSON text)
ENRICHMENT_SQL_TYPES = {
    "uniprot_id": "TEXT",
    "sequence": "TEXT",
    "sequence_length": "INTEGER",
    "molecular_weight_da": "REAL",
    "isoelectric_point": "REAL",
    "gravy_score": "REAL",
    "domains": "TEXT",
    "go_terms": "TEXT",
    "signal_peptide": "TEXT",
    "transmembrane_regions": "TEXT",
    "pathway": "TEXT",
    "pathways_detailed": "TEXT",
    "interacting_partners": "TEXT",
}

SQL_SECTION_MARKER = "-- PathoMap v2.2 derived tables schema"


def _effectors_table_sql() -> str:
    definitions = []
    for column in EFFECTOR_SQL_COLUMNS:
        if column == "entity_id":
            definitions.append("  entity_id              TEXT    PRIMARY KEY")
        elif column == "pathogen_id":
            definitions.append("  pathogen_id            INTEGER NOT NULL")
        elif column == "host_target_id":
            definitions.append("  host_target_id         INTEGER NOT NULL")
        elif column in ("effector_name", "pathogen_name", "host_target", "type", "mechanism"):
            definitions.append(f"  {column:<22} TEXT    NOT NULL")
        elif column in ENRICHMENT_SQL_TYPES:
            definitions.append(f"  {column:<22} {ENRICHMENT_SQL_TYPES[column]}")
        else:
            definitions.append(f"  {column:<22} TEXT")
    definitions.append("  FOREIGN KEY (pathogen_id) REFERENCES pathogens(pathogen_id)")
    definitions.append("  FOREIGN KEY (host_target_id) REFERENCES host_targets(host_target_id)")

    return "\n".join(
        [
            "CREATE TABLE effectors (",
            ",\n".join(definitions),
            ");",
            "",
            "CREATE INDEX idx_effectors_pathogen_id ON effectors(pathogen_id);",
            "CREATE INDEX idx_effectors_pathogen_name ON effectors(pathogen_name);",
            "CREATE INDEX idx_effectors_host_target_id ON effectors(host_target_id);",
        ]
    )


def _host_targets_table_sql() -> str:
    return "\n".join(
        [
            "CREATE TABLE host_targets (",
            "  entity_id              TEXT    PRIMARY KEY,",
            "  host_target_id         INTEGER NOT NULL UNIQUE,",
            "  name                   TEXT    NOT NULL UNIQUE,",
            "  host_target_class      TEXT    NOT NULL,",
            "  host_protein_id        INTEGER,",
            "  resolution_status      TEXT    NOT NULL CHECK (resolution_status IN ('resolved_protein', 'protein_family', 'protein_complex', 'ambiguous', 'non_protein', 'unresolved')),",
            "  audit_status           TEXT    NOT NULL CHECK (audit_status IN ('verified_protein', 'verified_protein_family', 'verified_complex', 'ambiguous', 'non_protein', 'unresolved')),",
            "  resolved_name          TEXT,",
            "  gene_symbol            TEXT,",
            "  uniprot_id             TEXT,",
            "  aliases                TEXT,",
            "  members                TEXT,",
            "  evidence_sources       TEXT    NOT NULL,",
            "  audit_notes            TEXT,",
            "  FOREIGN KEY (host_protein_id) REFERENCES host_proteins(host_protein_id)",
            ");",
            "",
            "CREATE INDEX idx_host_targets_host_protein_id ON host_targets(host_protein_id);",
            "CREATE INDEX idx_host_targets_class ON host_targets(host_target_class);",
            "CREATE INDEX idx_host_targets_resolution ON host_targets(resolution_status);",
            "CREATE INDEX idx_host_targets_uniprot_id ON host_targets(uniprot_id);",
        ]
    )


def _reference_links_table_sql() -> str:
    return "\n".join(
        [
            "CREATE TABLE host_protein_references (",
            "  host_protein_id INTEGER NOT NULL REFERENCES host_proteins(host_protein_id) ON DELETE CASCADE,",
            "  reference_id    TEXT    NOT NULL REFERENCES \"references\"(entity_id) ON DELETE CASCADE,",
            "  PRIMARY KEY (host_protein_id, reference_id)",
            ");",
            "",
            "CREATE TABLE effector_references (",
            "  effector_id  TEXT NOT NULL REFERENCES effectors(entity_id) ON DELETE CASCADE,",
            "  reference_id TEXT NOT NULL REFERENCES \"references\"(entity_id) ON DELETE CASCADE,",
            "  PRIMARY KEY (effector_id, reference_id)",
            ");",
            "",
            "CREATE INDEX idx_host_protein_references_ref ON host_protein_references(reference_id);",
            "CREATE INDEX idx_effector_references_ref ON effector_references(reference_id);",
        ]
    )


def _host_proteins_table_sql() -> str:
    definitions = []
    for column in HOST_PROTEIN_SQL_COLUMNS:
        if column == "entity_id":
            definitions.append("  entity_id            TEXT    NOT NULL UNIQUE")
        elif column == "host_protein_id":
            definitions.append("  host_protein_id      INTEGER PRIMARY KEY")
        elif column in ("protein_name", "gene_name", "localization", "function", "last_updated"):
            definitions.append(f"  {column:<21} TEXT    NOT NULL")
        elif column == "uniprot_id":
            definitions.append("  uniprot_id           TEXT    NOT NULL UNIQUE")
        elif column in ENRICHMENT_SQL_TYPES:
            definitions.append(f"  {column:<21} {ENRICHMENT_SQL_TYPES[column]}")
        else:
            definitions.append(f"  {column:<21} TEXT")

    return "\n".join(
        [
            "CREATE TABLE host_proteins (",
            ",\n".join(definitions),
            ");",
            "",
            "CREATE INDEX idx_host_proteins_uniprot_id ON host_proteins(uniprot_id);",
        ]
    )


def write_schema_sql() -> None:
    """Write (or refresh) the effectors/host_proteins section of schema.sql.

    The section is regenerated in place so column additions propagate to
    existing schema.sql files instead of being skipped as duplicates.
    """
    existing_sql = SQL_PATH.read_text(encoding="utf-8") if SQL_PATH.exists() else ""
    # Strip both the current marker and the pre-2.2 marker so rebuilds never
    # append a duplicate effectors/host_proteins section.
    for marker in (
        SQL_SECTION_MARKER,
        "-- PathoMap v2 effectors and host_proteins schema",
    ):
        existing_sql = existing_sql.split(marker)[0]
    base_sql = existing_sql.rstrip()

    section = (
        f"\n\n{SQL_SECTION_MARKER}\n"
        f"{_host_proteins_table_sql()}\n\n"
        f"{_host_targets_table_sql()}\n\n"
        f"{_effectors_table_sql()}\n\n"
        f"{_reference_links_table_sql()}\n"
    )
    SQL_PATH.write_text(base_sql + section, encoding="utf-8")


def _sqlite_value(value: Any) -> Any:
    """Serialize list/dict enrichment fields as JSON text for SQLite."""
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    return value


def _execute_ddl(con: sqlite3.Connection, sql: str) -> None:
    """Execute each ;-separated statement from generated DDL."""
    for statement in sql.split(";"):
        statement = statement.strip()
        if statement:
            con.execute(statement)


def write_sqlite(
    effectors: list[dict],
    host_proteins: list[dict],
    host_targets: list[dict],
    references: list[dict],
    built_at: str,
) -> None:
    """Rebuild the generated tables in SQLite.

    Tables are recreated from the generated DDL on every build so schema
    changes (new columns, primary keys, foreign keys) always apply.
    """
    con = sqlite3.connect(DB_PATH)
    try:
        con.execute("PRAGMA foreign_keys = ON")
        for table in (
            "effector_references",
            "host_protein_references",
            "effectors",
            "host_targets",
            "host_proteins",
        ):
            con.execute(f"DROP TABLE IF EXISTS {table}")
        _execute_ddl(con, _host_proteins_table_sql())
        _execute_ddl(con, _host_targets_table_sql())
        _execute_ddl(con, _effectors_table_sql())
        _execute_ddl(con, _reference_links_table_sql())

        # Stage 1 wrote pathogen references; add any host-protein references
        # that were not known until this stage.
        con.executemany(
            'INSERT OR IGNORE INTO "references" (entity_id, doi, url) VALUES (?, ?, ?)',
            [(ref["entity_id"], ref["doi"], ref["url"]) for ref in references],
        )

        # Insert host proteins and targets first; effectors reference them.
        host_protein_placeholders = ", ".join("?" for _ in HOST_PROTEIN_SQL_COLUMNS)
        host_protein_columns = ", ".join(HOST_PROTEIN_SQL_COLUMNS)
        con.executemany(
            f"INSERT INTO host_proteins ({host_protein_columns}) VALUES ({host_protein_placeholders})",
            [
                tuple(_sqlite_value(row.get(col)) for col in HOST_PROTEIN_SQL_COLUMNS)
                for row in host_proteins
            ],
        )

        target_placeholders = ", ".join("?" for _ in HOST_TARGET_COLUMNS)
        target_columns = ", ".join(HOST_TARGET_COLUMNS)
        con.executemany(
            f"INSERT INTO host_targets ({target_columns}) VALUES ({target_placeholders})",
            [
                tuple(_sqlite_value(row.get(col)) for col in HOST_TARGET_COLUMNS)
                for row in host_targets
            ],
        )

        effector_placeholders = ", ".join("?" for _ in EFFECTOR_SQL_COLUMNS)
        effector_columns = ", ".join(EFFECTOR_SQL_COLUMNS)
        con.executemany(
            f"INSERT INTO effectors ({effector_columns}) VALUES ({effector_placeholders})",
            [
                tuple(_sqlite_value(row.get(col)) for col in EFFECTOR_SQL_COLUMNS)
                for row in effectors
            ],
        )

        con.executemany(
            "INSERT INTO host_protein_references (host_protein_id, reference_id) VALUES (?, ?)",
            [
                (row["host_protein_id"], ref_id)
                for row in host_proteins
                for ref_id in row.get("reference_ids", [])
            ],
        )
        con.executemany(
            "INSERT INTO effector_references (effector_id, reference_id) VALUES (?, ?)",
            [
                (row["entity_id"], ref_id)
                for row in effectors
                for ref_id in row.get("reference_ids", [])
            ],
        )

        # Update meta table
        meta = {
            "dataset": DATASET_NAME,
            "schema_version": SCHEMA_VERSION,
            "built_at": built_at,
            "effector_count": str(len(effectors)),
            "host_protein_count": str(len(host_proteins)),
            "host_target_count": str(len(host_targets)),
            "reference_count": str(len(references)),
        }
        con.executemany("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", meta.items())
        con.commit()
    finally:
        con.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate without writing output files")
    parser.add_argument("--refresh", action="store_true", help="force fresh API calls (ignore cache)")
    parser.add_argument("--no-network", action="store_true", help="use only cached data (no API calls)")
    parser.add_argument(
        "--enrich-effectors",
        action="store_true",
        help="enrich effectors via UniProt mapping/search (slower, more API calls)",
    )
    args = parser.parse_args()

    if not PATHOGENS_DATASET_PATH.exists():
        print(f"error: missing pathogens dataset {PATHOGENS_DATASET_PATH}", file=sys.stderr)
        return 1

    built_at = utc_now()
    try:
        (
            effectors,
            host_proteins,
            host_targets,
            references,
            effector_registry,
            target_registry,
            reference_registry,
        ) = build_tables(args)
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    # Validate
    pathogen_rows = read_json(PATHOGENS_DATASET_PATH).get("pathogens", [])
    pathogen_ids = {int(row["pathogen_id"]) for row in pathogen_rows}
    host_protein_ids = {int(row["host_protein_id"]) for row in host_proteins}
    host_target_ids = {int(row["host_target_id"]) for row in host_targets}
    effector_errors = validate_effectors(effectors, pathogen_ids, host_target_ids)
    host_protein_errors = validate_host_proteins(host_proteins)
    host_target_errors = validate_host_targets(host_targets, host_protein_ids)
    reference_errors = validate_references(
        [*pathogen_rows, *host_proteins], references
    )
    enrichment_errors = validate_enriched_records(effectors, host_proteins)
    derived_payload = build_derived_features(effectors, built_at)
    derived_errors = validate_derived_features(effectors, derived_payload)

    if effector_errors:
        print(f"effector validation errors: {len(effector_errors)}", file=sys.stderr)
        for error in effector_errors:
            print(f"  - {error}", file=sys.stderr)

    if host_protein_errors:
        print(f"host_protein validation errors: {len(host_protein_errors)}", file=sys.stderr)
        for error in host_protein_errors:
            print(f"  - {error}", file=sys.stderr)

    if host_target_errors:
        print(f"host_target validation errors: {len(host_target_errors)}", file=sys.stderr)
        for error in host_target_errors:
            print(f"  - {error}", file=sys.stderr)

    if reference_errors:
        print(f"reference validation errors: {len(reference_errors)}", file=sys.stderr)
        for error in reference_errors:
            print(f"  - {error}", file=sys.stderr)

    if enrichment_errors:
        print(f"enrichment validation errors: {len(enrichment_errors)}", file=sys.stderr)
        for error in enrichment_errors:
            print(f"  - {error}", file=sys.stderr)

    if derived_errors:
        print(f"derived feature validation errors: {len(derived_errors)}", file=sys.stderr)
        for error in derived_errors:
            print(f"  - {error}", file=sys.stderr)

    if (
        effector_errors
        or host_protein_errors
        or host_target_errors
        or reference_errors
        or enrichment_errors
        or derived_errors
    ):
        return 1

    enriched_effectors = sum(1 for row in effectors if row.get("sequence"))
    enriched_host_proteins = sum(1 for row in host_proteins if row.get("sequence"))
    computed_features = sum(
        1 for row in derived_payload["features"] if row["feature_status"] == "computed"
    )
    missing_features = len(derived_payload["features"]) - computed_features
    print(f"effectors: {len(effectors)} ({enriched_effectors} enriched)")
    print(f"host_proteins: {len(host_proteins)} ({enriched_host_proteins} enriched)")
    print(f"host_targets: {len(host_targets)}")
    print(f"references: {len(references)}")
    print(f"derived effector features: {computed_features} computed, {missing_features} missing/incomplete")
    print("validation: ok")

    if args.check:
        return 0

    # Filter for sample
    sample_effectors, sample_host_proteins = filter_sample(effectors, host_proteins)
    sample_target_ids = {
        row["host_target_id"] for row in sample_effectors
    }
    sample_targets = [
        row for row in host_targets if row["host_target_id"] in sample_target_ids
    ]
    sample_pathogens = read_json(SAMPLE_DATASET_PATH).get("pathogens", [])
    sample_references = references_for_rows(
        [*sample_pathogens, *sample_host_proteins], references
    )
    print(f"sample effectors: {len(sample_effectors)}")
    print(f"sample host_proteins: {len(sample_host_proteins)}")
    print(f"sample host_targets: {len(sample_targets)}")

    # Update full dataset
    full_dataset = update_dataset(
        PATHOGENS_DATASET_PATH,
        effectors,
        host_proteins,
        host_targets,
        references,
        built_at,
    )
    write_json(PATHOGENS_DATASET_PATH, full_dataset)
    print(f"updated {PATHOGENS_DATASET_PATH.relative_to(ROOT)}")

    # Update sample dataset
    sample_dataset = update_dataset(
        SAMPLE_DATASET_PATH,
        sample_effectors,
        sample_host_proteins,
        sample_targets,
        sample_references,
        built_at,
    )
    write_json(SAMPLE_DATASET_PATH, sample_dataset)
    print(f"updated {SAMPLE_DATASET_PATH.relative_to(ROOT)}")

    # Derived features live outside the curated tables so they can be
    # recomputed without touching curated annotations.
    write_json(DERIVED_FEATURES_PATH, derived_payload)
    print(f"wrote {DERIVED_FEATURES_PATH.relative_to(ROOT)}")

    # Persist registries so future builds never renumber identities
    write_effector_registry(EFFECTOR_ID_REGISTRY_PATH, effector_registry)
    write_registry(
        HOST_TARGET_ID_REGISTRY_PATH,
        "host_targets",
        target_registry,
        (
            "Stable host-target entity IDs. Keys are normalized target names. "
            "IDs are assigned once and never reused; do not edit by hand unless "
            "you are intentionally repairing an assignment."
        ),
    )
    write_registry(
        REFERENCE_ID_REGISTRY_PATH,
        "references",
        reference_registry,
        (
            "Stable reference entity IDs. Keys are normalized DOIs. IDs are "
            "assigned once and never reused; do not edit by hand unless you are "
            "intentionally repairing an assignment."
        ),
    )
    print(f"wrote {EFFECTOR_ID_REGISTRY_PATH.relative_to(ROOT)}")
    print(f"wrote {HOST_TARGET_ID_REGISTRY_PATH.relative_to(ROOT)}")
    print(f"wrote {REFERENCE_ID_REGISTRY_PATH.relative_to(ROOT)}")

    # Write SQLite database and SQL schema
    write_schema_sql()
    write_sqlite(effectors, host_proteins, host_targets, references, built_at)
    print(f"wrote {DB_PATH.relative_to(ROOT)}")
    print(f"wrote {SQL_PATH.relative_to(ROOT)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

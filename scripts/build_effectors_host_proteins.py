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
CLASSIFICATION_MAPPING_PATH = ROOT / "data" / "classification-mapping.json"
EFFECTOR_UNIPROT_MAPPING_PATH = ROOT / "data" / "sources" / "effector_uniprot_mapping.json"
CACHE_ROOT = ROOT / "data" / "sources"
DB_PATH = ROOT / "data" / "pathomap.db"
SQL_PATH = ROOT / "data" / "schema.sql"

SCHEMA_VERSION = "2.0"
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


def build_tables(args: argparse.Namespace) -> tuple[list[dict], list[dict]]:
    """Build effectors and host_proteins tables from seed files."""
    # Read seed files
    if not EFFECTORS_SEED_PATH.exists():
        raise BuildError(f"missing seed file {EFFECTORS_SEED_PATH}")
    if not HOST_PROTEINS_SEED_PATH.exists():
        raise BuildError(f"missing seed file {HOST_PROTEINS_SEED_PATH}")

    effectors = read_json(EFFECTORS_SEED_PATH)
    host_proteins = read_json(HOST_PROTEINS_SEED_PATH)

    # Read classification mapping
    if not CLASSIFICATION_MAPPING_PATH.exists():
        raise BuildError(f"missing classification mapping {CLASSIFICATION_MAPPING_PATH}")
    classification_mapping = read_classification_mapping(CLASSIFICATION_MAPPING_PATH)

    # Apply classifications to effectors
    effectors = apply_classifications(effectors, classification_mapping)

    # Read pathogens to validate pathogen_name references
    pathogens = read_pathogens(PATHOGENS_DATASET_PATH)

    # Validate that all pathogen_name references exist in pathogens table
    for effector in effectors:
        pathogen_name = effector.get("pathogen_name")
        if pathogen_name not in pathogens:
            raise BuildError(
                f"effector references unknown pathogen {pathogen_name!r}"
            )

    # Enrich with external API data (UniProt/InterPro/Pfam/STRING)
    effectors, host_proteins = enrich_records(effectors, host_proteins, args)

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

    # Record enrichment sources when API data is present
    if any(row.get("sequence") for row in host_proteins) or any(
        row.get("sequence") for row in effectors
    ):
        sources = dataset["meta"].setdefault("sources", {})
        sources.setdefault("uniprot", "https://rest.uniprot.org/")
        sources.setdefault("interpro", "https://www.ebi.ac.uk/interpro/")
        sources.setdefault("string", "https://string-db.org/")

    # Update tables
    dataset["effectors"] = effectors
    dataset["host_proteins"] = host_proteins

    return dataset


EFFECTOR_COLUMNS = [
    "effector_name",
    "effector_name_class",
    "pathogen_name",
    "host_target",
    "host_target_class",
    "type",
    "type_class",
    "mechanism",
    "mechanism_class",
    "uniprot_id",
    "sequence",
    "sequence_length",
    "molecular_weight_da",
    "isoelectric_point",
    "gravy_score",
    "domains",
    "go_terms",
    "signal_peptide",
    "transmembrane_regions",
]

HOST_PROTEIN_COLUMNS = [
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
    "last_updated",
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

SQL_SECTION_MARKER = "-- PathoMap v2 effectors and host_proteins schema"


def _effectors_table_sql() -> str:
    definitions = []
    for column in EFFECTOR_COLUMNS:
        if column in ("effector_name", "pathogen_name", "host_target", "type", "mechanism"):
            definitions.append(f"  {column:<22} TEXT    NOT NULL")
        elif column in ENRICHMENT_SQL_TYPES:
            definitions.append(f"  {column:<22} {ENRICHMENT_SQL_TYPES[column]}")
        else:
            definitions.append(f"  {column:<22} TEXT")
    definitions.append("  PRIMARY KEY (effector_name, pathogen_name)")

    return "\n".join(
        [
            "CREATE TABLE effectors (",
            ",\n".join(definitions),
            ");",
            "",
            "CREATE INDEX idx_effectors_pathogen_name ON effectors(pathogen_name);",
        ]
    )


def _host_proteins_table_sql() -> str:
    definitions = []
    for column in HOST_PROTEIN_COLUMNS:
        if column == "host_protein_id":
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
    base_sql = existing_sql.split(SQL_SECTION_MARKER)[0].rstrip()

    section = (
        f"\n\n{SQL_SECTION_MARKER}\n"
        f"{_effectors_table_sql()}\n\n"
        f"{_host_proteins_table_sql()}\n"
    )
    SQL_PATH.write_text(base_sql + section, encoding="utf-8")


def _sqlite_value(value: Any) -> Any:
    """Serialize list/dict enrichment fields as JSON text for SQLite."""
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    return value


def _ensure_columns(con: sqlite3.Connection, table: str, columns: list[str]) -> None:
    """ALTER TABLE ... ADD COLUMN for any enrichment columns missing from an old table."""
    existing = {
        row[1] for row in con.execute(f"PRAGMA table_info({table})").fetchall()
    }
    for column in columns:
        if column not in existing:
            sql_type = ENRICHMENT_SQL_TYPES.get(column, "TEXT")
            con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}")


def write_sqlite(effectors: list[dict], host_proteins: list[dict]) -> None:
    """Write effectors and host_proteins to SQLite database."""
    con = sqlite3.connect(DB_PATH)
    try:
        # Check if tables exist, create if not
        cursor = con.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='effectors'")
        effectors_exists = cursor.fetchone() is not None
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='host_proteins'")
        host_proteins_exists = cursor.fetchone() is not None

        # Only create the new tables if they don't exist
        if not effectors_exists:
            create_sql = "\n".join(
                line
                for line in _effectors_table_sql().splitlines()
                if not line.startswith("CREATE INDEX")
            )
            con.execute(create_sql)

        if not host_proteins_exists:
            create_sql = "\n".join(
                line
                for line in _host_proteins_table_sql().splitlines()
                if not line.startswith("CREATE INDEX")
            )
            con.execute(create_sql)

        # Migrate older tables by adding any missing enrichment columns
        _ensure_columns(con, "effectors", EFFECTOR_COLUMNS)
        _ensure_columns(con, "host_proteins", HOST_PROTEIN_COLUMNS)

        # Delete existing data and insert fresh
        con.execute("DELETE FROM effectors")
        con.execute("DELETE FROM host_proteins")

        # Insert effectors
        effector_placeholders = ", ".join("?" for _ in EFFECTOR_COLUMNS)
        effector_columns = ", ".join(EFFECTOR_COLUMNS)
        con.executemany(
            f"INSERT INTO effectors ({effector_columns}) VALUES ({effector_placeholders})",
            [tuple(_sqlite_value(row.get(col)) for col in EFFECTOR_COLUMNS) for row in effectors],
        )

        # Insert host_proteins
        host_protein_placeholders = ", ".join("?" for _ in HOST_PROTEIN_COLUMNS)
        host_protein_columns = ", ".join(HOST_PROTEIN_COLUMNS)
        con.executemany(
            f"INSERT INTO host_proteins ({host_protein_columns}) VALUES ({host_protein_placeholders})",
            [
                tuple(_sqlite_value(row.get(col)) for col in HOST_PROTEIN_COLUMNS)
                for row in host_proteins
            ],
        )

        # Update meta table
        meta = {
            "dataset": DATASET_NAME,
            "schema_version": SCHEMA_VERSION,
            "built_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "effector_count": str(len(effectors)),
            "host_protein_count": str(len(host_proteins)),
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

    try:
        effectors, host_proteins = build_tables(args)
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    # Validate
    effector_errors = validate_effectors(effectors)
    host_protein_errors = validate_host_proteins(host_proteins)
    enrichment_errors = validate_enriched_records(effectors, host_proteins)

    if effector_errors:
        print(f"effector validation errors: {len(effector_errors)}", file=sys.stderr)
        for error in effector_errors:
            print(f"  - {error}", file=sys.stderr)

    if host_protein_errors:
        print(f"host_protein validation errors: {len(host_protein_errors)}", file=sys.stderr)
        for error in host_protein_errors:
            print(f"  - {error}", file=sys.stderr)

    if enrichment_errors:
        print(f"enrichment validation errors: {len(enrichment_errors)}", file=sys.stderr)
        for error in enrichment_errors:
            print(f"  - {error}", file=sys.stderr)

    if effector_errors or host_protein_errors or enrichment_errors:
        return 1

    enriched_effectors = sum(1 for row in effectors if row.get("sequence"))
    enriched_host_proteins = sum(1 for row in host_proteins if row.get("sequence"))
    print(f"effectors: {len(effectors)} ({enriched_effectors} enriched)")
    print(f"host_proteins: {len(host_proteins)} ({enriched_host_proteins} enriched)")
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

    # Write SQLite database and SQL schema
    write_schema_sql()
    write_sqlite(effectors, host_proteins)
    print(f"wrote {DB_PATH.relative_to(ROOT)}")
    print(f"wrote {SQL_PATH.relative_to(ROOT)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

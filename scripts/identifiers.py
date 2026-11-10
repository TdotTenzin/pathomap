"""Canonical PathoMap entity identifiers.

Every entity in the dataset carries one opaque, prefixed string ID:

    PM-<TYPE>-<NNNN>

where TYPE is PAT (pathogen), EFF (effector protein), HST (human host
protein), REF (reference), TGT (host target), INT (interaction) or EVD
(interaction evidence) and NNNN is a zero-padded
sequence number (at least four digits).

Stability rules:
  - Pathogen IDs are derived from the curated, immutable ``pathogen_id``.
  - Host-protein IDs are derived from the curated ``host_protein_id``.
  - Effector, reference and host-target IDs are assigned once and persisted in
    registries. Registry entries are never reused or renumbered, even if a row
    is removed and later re-added.

The ID itself never encodes a display name or table join key, so future
interaction records can reference it without ambiguity.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable, Mapping

ENTITY_PREFIXES = {
    "pathogen": "PAT",
    "effector": "EFF",
    "host_protein": "HST",
    "reference": "REF",
    "host_target": "TGT",
    "interaction": "INT",
    "interaction_evidence": "EVD",
}

ENTITY_ID_PATTERN = re.compile(r"^PM-(PAT|EFF|HST|REF|TGT|INT|EVD)-(\d{4,})$")
MIN_SEQUENCE_WIDTH = 4


def entity_id(entity_type: str, number: int) -> str:
    """Return the canonical ID for an entity type and positive sequence number."""
    prefix = ENTITY_PREFIXES.get(entity_type)
    if prefix is None:
        raise ValueError(f"unknown entity type {entity_type!r}")
    if not isinstance(number, int) or number <= 0:
        raise ValueError(f"{entity_type} sequence number must be a positive integer")
    return f"PM-{prefix}-{number:0{MIN_SEQUENCE_WIDTH}d}"


def is_entity_id(value: Any, entity_type: str | None = None) -> bool:
    """Check that ``value`` is a valid entity ID, optionally of one type."""
    if not isinstance(value, str):
        return False
    match = ENTITY_ID_PATTERN.fullmatch(value)
    if match is None:
        return False
    return entity_type is None or match.group(1) == ENTITY_PREFIXES[entity_type]


def entity_type_from_id(value: Any) -> str | None:
    """Return the entity type encoded in an ID, or None if it is malformed."""
    if not isinstance(value, str):
        return None
    match = ENTITY_ID_PATTERN.fullmatch(value)
    if match is None:
        return None
    by_prefix = {prefix: name for name, prefix in ENTITY_PREFIXES.items()}
    return by_prefix.get(match.group(1))


# ---------------------------------------------------------------------------
# Stable natural keys for registered entity types
# ---------------------------------------------------------------------------

def effector_key(pathogen_id: int, effector_name: str) -> str:
    """Natural key used to keep effector IDs stable across builds."""
    return f"{int(pathogen_id)}|{effector_name.strip()}"


def reference_key(doi: str) -> str:
    """Normalized DOI key used for reference identity."""
    return doi.strip().casefold()


def host_target_key(name: str) -> str:
    """Normalized host-target name key used for target identity."""
    return " ".join(name.split()).casefold()


def interaction_key(effector_id: str, host_protein_id: str) -> str:
    """Natural key for a directed effector-to-host-protein relationship."""
    return f"{effector_id}|{host_protein_id}"


def interaction_evidence_key(
    interaction_id: str,
    evidence_class: str,
    doi: str | None,
    pmid: str | None,
    database_accession: str | None,
    provenance: str,
) -> str:
    """Stable evidence key; all source identifiers participate in identity."""
    return "|".join([
        interaction_id,
        evidence_class.strip().casefold(),
        (doi or "").strip().casefold(),
        (pmid or "").strip(),
        (database_accession or "").strip().casefold(),
        provenance.strip().casefold(),
    ])


# ---------------------------------------------------------------------------
# Generic registry handling
# ---------------------------------------------------------------------------

def load_registry(path: Path, section: str) -> dict[str, str]:
    """Read a persisted ID registry section (empty when the file is absent)."""
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    registry = payload.get(section, payload)
    if not isinstance(registry, dict):
        raise ValueError(f"invalid '{section}' ID registry in {path}")
    return {str(key): str(value) for key, value in registry.items()}


def validate_registry(registry: Mapping[str, str], entity_type: str) -> list[str]:
    """Return errors for malformed or duplicate registry entries."""
    errors: list[str] = []
    seen_ids: dict[str, str] = {}
    for key, value in registry.items():
        if not key:
            errors.append(f"{entity_type} registry contains an empty key")
        if not is_entity_id(value, entity_type):
            errors.append(
                f"{entity_type} registry value {value!r} for {key!r} is not a valid {entity_type} ID"
            )
            continue
        if value in seen_ids:
            errors.append(
                f"{entity_type} registry ID {value} is assigned to both "
                f"{seen_ids[value]!r} and {key!r}"
            )
        else:
            seen_ids[value] = key
    return errors


def assign_registry_ids(
    ordered_keys: Iterable[str],
    registry: Mapping[str, str],
    entity_type: str,
) -> dict[str, str]:
    """Assign IDs to new keys without renumbering existing entries.

    ``ordered_keys`` must be deterministic so a first build is reproducible.
    Returns the updated registry.
    """
    updated = dict(registry)
    prefix = ENTITY_PREFIXES[entity_type]
    used_numbers = {
        int(match.group(2))
        for value in updated.values()
        if (match := ENTITY_ID_PATTERN.fullmatch(value)) and match.group(1) == prefix
    }
    next_number = max(used_numbers, default=0) + 1

    for key in ordered_keys:
        if key in updated:
            continue
        updated[key] = entity_id(entity_type, next_number)
        next_number += 1
    return updated


def write_registry(
    path: Path,
    section: str,
    registry: Mapping[str, str],
    description: str,
    sort_key=None,
) -> None:
    """Persist a registry in deterministic key order."""
    payload = {
        "schema_version": "1.0",
        "description": description,
        section: {key: registry[key] for key in sorted(registry, key=sort_key)},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Effector-specific helpers (kept as stable public API)
# ---------------------------------------------------------------------------

def load_effector_registry(path: Path) -> dict[str, str]:
    return load_registry(path, "effectors")


def validate_effector_registry(registry: Mapping[str, str]) -> list[str]:
    return validate_registry(registry, "effector")


def assign_effector_ids(
    effectors: Iterable[dict],
    registry: Mapping[str, str],
) -> tuple[dict[int, str], dict[str, str]]:
    """Assign effector IDs without renumbering existing entries.

    Returns ``(ids_by_row_index, updated_registry)``. New keys are assigned in
    deterministic ``(pathogen_id, effector_name)`` order so a first build is
    reproducible regardless of seed-file order.
    """
    rows = list(effectors)
    pending: list[tuple[int, str, int]] = []
    for index, row in enumerate(rows):
        pathogen_id = row.get("pathogen_id")
        name = row.get("effector_name")
        if isinstance(pathogen_id, int) and name:
            pending.append((pathogen_id, effector_key(pathogen_id, name), index))

    ordered_keys = [key for _pid, key, _index in sorted(pending)]
    updated = assign_registry_ids(ordered_keys, registry, "effector")

    assigned: dict[int, str] = {}
    for index, row in enumerate(rows):
        pathogen_id = row.get("pathogen_id")
        name = row.get("effector_name")
        if isinstance(pathogen_id, int) and name:
            key = effector_key(pathogen_id, name)
            assigned[index] = updated[key]
    return assigned, updated


def _effector_registry_sort_key(key: str) -> tuple[int, str]:
    """Sort '<pathogen_id>|<effector_name>' numerically, then by name."""
    pathogen_id, _, name = key.partition("|")
    try:
        return int(pathogen_id), name
    except ValueError:
        return 0, key


def write_effector_registry(path: Path, registry: Mapping[str, str]) -> None:
    write_registry(
        path,
        "effectors",
        registry,
        (
            "Stable effector entity IDs. Keys are '<pathogen_id>|<effector_name>'. "
            "IDs are assigned once and never reused; do not edit by hand unless "
            "you are intentionally repairing an assignment."
        ),
        sort_key=_effector_registry_sort_key,
    )

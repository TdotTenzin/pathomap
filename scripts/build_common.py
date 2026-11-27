#!/usr/bin/env python3
"""Shared helpers for the PathoMap dataset build scripts."""

from __future__ import annotations

import datetime as dt
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Callable

# Add scripts directory to path for relative imports when run as module
sys.path.insert(0, str(Path(__file__).parent))

from identifiers import is_entity_id, reference_key
from io_utils import (  # re-exported for the build scripts
    no_writes,
    read_json,
    write_json,
    write_text,
    writes_enabled,
)

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"


class BuildError(RuntimeError):
    pass


def utc_now() -> str:
    return (
        dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def begin_sqlite_write(
    path: Path,
    *,
    reuse_existing: bool = False,
) -> tuple[sqlite3.Connection, Callable[[sqlite3.Connection], None]]:
    """Open a temporary SQLite DB for an atomic rebuild.

    The returned ``finalize`` callback commits and swaps the temp file into
    place on success, or discards it on failure. When writes are suppressed
    (strict ``--check``), an in-memory DB is used and no file is touched.
    """
    if not writes_enabled():
        connection = sqlite3.connect(":memory:")
        return connection, lambda con: con.close()

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    if temporary.exists():
        temporary.unlink()
    if reuse_existing and path.exists():
        shutil.copyfile(path, temporary)

    connection = sqlite3.connect(temporary)

    def finalize(con: sqlite3.Connection) -> None:
        failed = sys.exc_info()[0] is not None
        try:
            if failed:
                con.rollback()
            else:
                con.commit()
                con.close()
                temporary.replace(path)
        finally:
            con.close()
            if temporary.exists():
                temporary.unlink()

    return connection, finalize


def references_for_rows(rows: list[dict], references: list[dict]) -> list[dict]:
    """Select the reference rows used by a subset of dataset rows."""
    used = {ref_id for row in rows for ref_id in row.get("reference_ids", [])}
    return [ref for ref in references if ref["entity_id"] in used]


def validate_references(
    rows: list[dict],
    references: list[dict],
    *,
    require_reference_ids: bool = True,
) -> list[str]:
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
        label = f"row {index} ({row.get('name', '?')})"
        ref_ids = row.get("reference_ids")
        if not isinstance(ref_ids, list):
            errors.append(f"{label}: reference_ids must be a list")
            continue
        if require_reference_ids and not ref_ids:
            errors.append(f"{label}: reference_ids must be a non-empty list")
            continue
        if len(set(ref_ids)) != len(ref_ids):
            errors.append(f"{label}: reference_ids contains duplicates")
        for ref_id in ref_ids:
            if not is_entity_id(ref_id, "reference"):
                errors.append(f"{label}: invalid reference ID {ref_id!r}")
            elif ref_id not in seen_ids:
                errors.append(f"{label}: unknown reference ID {ref_id}")
        doi = row.get("reference_doi")
        expected = [
            ref["entity_id"]
            for ref in references
            if isinstance(doi, str) and reference_key(ref["doi"]) == reference_key(doi)
        ]
        if expected and ref_ids != expected:
            errors.append(f"{label}: reference_ids do not match reference_doi")
    return errors

"""
notebooks.py — Access the generated, downloadable analysis notebooks.

The notebooks are produced by `scripts/export_notebook.py` and stored under
`data/notebooks/`. This module exposes their metadata and contents to the API;
nothing is generated at request time.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_NB_DIR = Path(__file__).resolve().parent / "data" / "notebooks"
_MANIFEST = _NB_DIR / "manifest.json"


@lru_cache(maxsize=1)
def list_notebooks() -> tuple[dict, ...]:
    """Metadata for every generated notebook (empty if none are built)."""
    if not _MANIFEST.exists():
        return ()
    with _MANIFEST.open("r", encoding="utf-8") as f:
        manifest = json.load(f)
    return tuple(manifest)


def get_notebook(slug: str) -> dict | None:
    """Return the raw nbformat-4 notebook for a slug, or None if unknown."""
    entry = next((n for n in list_notebooks() if n["slug"] == slug), None)
    if entry is None:
        return None
    path = _NB_DIR / entry["filename"]
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

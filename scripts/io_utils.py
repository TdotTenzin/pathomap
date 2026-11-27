"""Low-level file I/O shared by the PathoMap build scripts.

All dataset, schema, registry and cache writes go through this module so that
``--check`` can be strictly read-only and so a failed write never leaves a
partially written artifact behind.
"""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

_WRITES_ENABLED = True


def writes_enabled() -> bool:
    """Return whether filesystem writes are currently permitted."""
    return _WRITES_ENABLED


@contextmanager
def no_writes() -> Iterator[None]:
    """Temporarily suppress every write performed through this module."""
    global _WRITES_ENABLED
    previous = _WRITES_ENABLED
    _WRITES_ENABLED = False
    try:
        yield
    finally:
        _WRITES_ENABLED = previous


def read_json(path: Path) -> Any:
    """Read and parse a JSON file."""
    return json.loads(path.read_text(encoding="utf-8"))


def write_bytes(path: Path, payload: bytes) -> None:
    """Write bytes atomically, unless writes are suppressed."""
    if not _WRITES_ENABLED:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_bytes(payload)
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def write_text(path: Path, text: str, *, atomic: bool = True) -> None:
    """Write UTF-8 text with LF endings, atomically by default."""
    if not _WRITES_ENABLED:
        return
    payload = text.encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    if not atomic:
        path.write_bytes(payload)
        return
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_bytes(payload)
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def write_json(path: Path, payload: Any) -> None:
    """Write JSON with stable formatting; rejects NaN/Infinity."""
    write_text(
        path,
        json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
    )

#!/usr/bin/env python3
"""Shared helpers for PathoMap derived analysis engines.

The helpers keep provenance, validation and statistical primitives consistent
across the Phase 6 analysis modules. They intentionally use only the Python
standard library.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_dataset(path: Path) -> tuple[dict, bytes]:
    source_bytes = path.read_bytes()
    dataset = json.loads(source_bytes)
    if not isinstance(dataset, dict):
        raise ValueError("dataset must be a JSON object")
    return dataset, source_bytes


def timestamp() -> str:
    return (
        dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def issue(code: str, detail: str, row_id: str | None = None) -> dict:
    result = {"code": code, "detail": detail}
    if row_id:
        result["row_id"] = row_id
    return result


def issue_sort_key(item: dict) -> tuple[str, str, str]:
    return (str(item.get("row_id") or ""), item["code"], item["detail"])


def count_issue_codes(issues: Iterable[dict]) -> dict[str, int]:
    return dict(sorted(Counter(item["code"] for item in issues).items()))


def blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def source_path_label(path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def table_rows(dataset: dict, name: str, table_issues: list[dict] | None = None) -> list:
    issues = table_issues if table_issues is not None else []
    if name not in dataset:
        issues.append(issue("missing_table", f"Required table '{name}' is missing."))
        return []
    rows = dataset[name]
    if not isinstance(rows, list):
        issues.append(issue("invalid_table", f"Table '{name}' is not an array."))
        return []
    return rows


def provenance_meta(
    *,
    analysis: str,
    analysis_version: str,
    dataset: dict,
    source_bytes: bytes,
    dataset_path: Path | None,
    input_tables: list[str],
    parameters: dict,
) -> dict:
    return {
        "analysis": analysis,
        "analysis_version": analysis_version,
        "generated_at": timestamp(),
        "source_dataset_path": source_path_label(dataset_path),
        "source_dataset_schema_version": dataset.get("meta", {}).get("schema_version"),
        "source_dataset_built_at": dataset.get("meta", {}).get("built_at"),
        "source_dataset_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "input_tables": input_tables,
        "parameters": parameters,
    }


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def status_from_reasons(reasons: list[str], *, low_power: list[str] | None = None) -> str:
    if reasons:
        return "insufficient_data"
    if low_power:
        return "low_power"
    return "complete"


def _log_comb(n: int, k: int) -> float:
    if k < 0 or n < 0 or k > n:
        return float("-inf")
    return math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1)


def hypergeom_sf(k: int, population: int, successes: int, draws: int) -> float:
    """P(X >= k) for X ~ Hypergeometric(population, successes, draws)."""
    if population <= 0 or draws <= 0 or successes <= 0:
        return 1.0
    min_k = max(0, draws - (population - successes))
    max_k = min(successes, draws)
    if k <= min_k:
        return 1.0
    if k > max_k:
        return 0.0
    denominator = _log_comb(population, draws)
    terms = []
    for i in range(k, max_k + 1):
        log_pmf = (
            _log_comb(successes, i)
            + _log_comb(population - successes, draws - i)
            - denominator
        )
        terms.append(log_pmf)
    if not terms:
        return 0.0
    largest = max(terms)
    total = largest + math.log(sum(math.exp(item - largest) for item in terms))
    return min(1.0, math.exp(total))


def bh_adjust(pvalues: list[float]) -> list[float]:
    """Benjamini-Hochberg adjusted p-values, preserving input order."""
    count = len(pvalues)
    if count == 0:
        return []
    ordered = sorted(range(count), key=lambda index: (pvalues[index], index))
    adjusted = [1.0] * count
    running = 1.0
    for rank in range(count - 1, -1, -1):
        index = ordered[rank]
        value = pvalues[index] * count / (rank + 1)
        running = min(running, value, 1.0)
        adjusted[index] = running
    return adjusted


def jaccard(left: Iterable[str], right: Iterable[str]) -> float | None:
    left_set, right_set = set(left), set(right)
    union = left_set | right_set
    if not union:
        return None
    return len(left_set & right_set) / len(union)


def mean(values: Iterable[float]) -> float | None:
    items = list(values)
    return sum(items) / len(items) if items else None


def median(values: Iterable[float]) -> float | None:
    items = sorted(values)
    if not items:
        return None
    mid = len(items) // 2
    if len(items) % 2:
        return items[mid]
    return (items[mid - 1] + items[mid]) / 2.0


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "item"


def round_or_none(value: float | None, digits: int = 4) -> float | None:
    return None if value is None else round(value, digits)

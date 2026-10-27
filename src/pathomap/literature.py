"""
literature.py — Real PubMed references attached to curated pathogens.

Reads `data/seed/literature.csv`, which is produced by
`scripts/fetch_literature.py` from the NCBI E-utilities API. Only verifiable
fields are stored (PMID, title, journal, year, authors); the interpretive
columns `key_findings` and `knowledge_gap` are intentionally blank until a
human fills them in.
"""

from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

_CSV = Path(__file__).resolve().parent / "data" / "seed" / "literature.csv"

PUBMED_URL = "https://pubmed.ncbi.nlm.nih.gov/{pmid}/"


def _pubmed_url(pmid: str) -> str:
    return PUBMED_URL.format(pmid=pmid)


@lru_cache(maxsize=1)
def load_literature() -> tuple[dict, ...]:
    """Load the cached literature CSV (empty tuple if it has not been fetched)."""
    if not _CSV.exists():
        return ()
    with _CSV.open("r", newline="", encoding="utf-8") as f:
        records = []
        for row in csv.DictReader(f):
            pmid = (row.get("pubmed_id") or "").strip()
            if not pmid:
                continue
            row["pubmed_id"] = pmid
            row["pubmed_url"] = _pubmed_url(pmid)
            row["key_findings"] = (row.get("key_findings") or "").strip()
            row["knowledge_gap"] = (row.get("knowledge_gap") or "").strip()
            records.append(row)
        return tuple(records)


def get_pathogen_literature(pathogen: str) -> list[dict]:
    """Return the PubMed references for one pathogen (case-insensitive)."""
    name = pathogen.strip().lower()
    return [r for r in load_literature() if r["pathogen_name"].strip().lower() == name]


def literature_coverage() -> dict:
    """Honest coverage summary for the literature layer."""
    records = load_literature()
    pathogens = {r["pathogen_name"] for r in records}
    curated = sum(1 for r in records if r.get("key_findings") or r.get("knowledge_gap"))
    return {
        "records": len(records),
        "pathogens_covered": len(pathogens),
        "curated": curated,
    }

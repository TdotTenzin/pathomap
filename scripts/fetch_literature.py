"""
fetch_literature.py — Attach real PubMed references to curated pathogens.

The curated database stores no literature. This script queries the NCBI
E-utilities API (esearch + esummary) for each pathogen and caches the real
bibliographic records to `src/pathomap/data/seed/literature.csv`, together with
the exact query and the fetch timestamp so the result is auditable and
reproducible.

Only machine-verifiable fields are written (PMID, title, journal, year,
authors). The interpretive columns `key_findings` and `knowledge_gap` are left
blank on purpose — they require human reading and must not be fabricated.

Usage:
    python scripts/fetch_literature.py [--force] [--limit N] [--retmax 3]
"""

from __future__ import annotations

import argparse
import csv
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "src" / "pathomap" / "data" / "pathomap.db"
OUT_PATH = ROOT / "src" / "pathomap" / "data" / "seed" / "literature.csv"

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
USER_AGENT = "pathomap-research/0.1 (educational; local use)"
TOOL = "pathomap"

# Relevance qualifier so hits are about pathogenesis rather than, say, a
# serotyping method. Kept in the CSV `query` column for full provenance.
QUERY_SUFFIX = "(virulence OR pathogenesis OR infection OR immune OR effector OR host)"

CSV_FIELDS = [
    "pathogen_name",
    "pubmed_id",
    "title",
    "journal",
    "year",
    "authors",
    "key_findings",
    "knowledge_gap",
    "query",
    "fetched_utc",
]


def _request(endpoint: str, params: dict, timeout: int = 30, retries: int = 4) -> dict:
    """GET an E-utilities JSON endpoint, honouring rate limits with backoff."""
    params = {"tool": TOOL, **params}
    url = EUTILS + endpoint + "?" + urllib.parse.urlencode(params)
    delay = 1.0
    last_err: Exception | None = None
    for _ in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(delay)
                delay *= 2
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"E-utilities request failed after retries: {last_err}")


def _year(pubdate: str) -> str:
    for token in (pubdate or "").replace("-", " ").split():
        if token.isdigit() and len(token) == 4:
            return token
    return ""


def _authors(record: dict, max_names: int = 3) -> str:
    names = [a.get("name", "") for a in record.get("authors", []) if a.get("name")]
    if not names:
        return ""
    if len(names) <= max_names:
        return ", ".join(names)
    return ", ".join(names[:max_names]) + " et al."


def fetch_for_pathogen(pathogen: str, retmax: int) -> list[dict]:
    """Return up to `retmax` real PubMed records for one pathogen."""
    query = f'"{pathogen}" AND {QUERY_SUFFIX}'
    search = _request(
        "esearch.fcgi",
        {"db": "pubmed", "term": query, "retmax": retmax, "retmode": "json", "sort": "relevance"},
    )
    time.sleep(0.34)  # <= 3 requests/second without an API key
    ids = search.get("esearchresult", {}).get("idlist", [])
    if not ids:
        return []

    summary = _request(
        "esummary.fcgi",
        {"db": "pubmed", "id": ",".join(ids), "retmode": "json"},
    )
    time.sleep(0.34)

    fetched = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    result = summary.get("result", {})
    rows: list[dict] = []
    for pmid in ids:
        rec = result.get(pmid)
        if not rec or "error" in rec:
            continue
        rows.append({
            "pathogen_name": pathogen,
            "pubmed_id": pmid,
            "title": (rec.get("title", "") or "").rstrip("."),
            "journal": rec.get("fulljournalname", "") or rec.get("source", ""),
            "year": _year(rec.get("pubdate", "")),
            "authors": _authors(rec),
            "key_findings": "",
            "knowledge_gap": "",
            "query": query,
            "fetched_utc": fetched,
        })
    return rows


def load_pathogens() -> list[str]:
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT name FROM pathogens ORDER BY name").fetchall()
    conn.close()
    return [r[0] for r in rows]


def load_existing() -> list[dict]:
    if not OUT_PATH.exists():
        return []
    with OUT_PATH.open("r", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_rows(rows: list[dict]) -> None:
    rows = sorted(rows, key=lambda r: (r["pathogen_name"], r["pubmed_id"]))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="refetch every pathogen")
    ap.add_argument("--limit", type=int, default=None, help="only the first N pathogens")
    ap.add_argument("--retmax", type=int, default=3, help="records per pathogen")
    args = ap.parse_args()

    pathogens = load_pathogens()
    if args.limit:
        pathogens = pathogens[: args.limit]

    existing = load_existing()
    done = set() if args.force else {r["pathogen_name"] for r in existing}
    rows: list[dict] = [] if args.force else list(existing)

    for i, pathogen in enumerate(pathogens, 1):
        if pathogen in done:
            print(f"[{i}/{len(pathogens)}] {pathogen} (cached)")
            continue
        print(f"[{i}/{len(pathogens)}] {pathogen}")
        try:
            recs = fetch_for_pathogen(pathogen, args.retmax)
        except Exception as e:  # noqa: BLE001
            print(f"    ! failed: {e}")
            recs = []
        if recs:
            rows.extend(recs)
            print(f"    + {len(recs)} record(s): " + ", ".join(r["pubmed_id"] for r in recs))
        else:
            print("    - no records")
        write_rows(rows)  # resumable: persist after every pathogen

    write_rows(rows)
    print(f"\nWrote {len(rows)} records to {OUT_PATH.relative_to(ROOT)}")
    print(f"Pathogens covered: {len({r['pathogen_name'] for r in rows})}/{len(pathogens)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

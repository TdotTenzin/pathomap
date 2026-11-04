"""API clients for protein data enrichment.

Provides reusable functions for fetching data from UniProt, InterPro, Pfam,
and STRING. Includes retry logic, rate limiting, and on-disk caching so builds
are reproducible and can run offline with cached responses.

Cache layout (relative to ``data/sources``):

    uniprot/entries/{accession}.json      Full UniProt entries
    uniprot/sequences/{accession}.json    Sequence-only responses
    uniprot/search/{query}.json           Effector name -> accession searches
    interpro/matches/{accession}.json     InterPro domain annotations
    pfam/matches/{accession}.json         Pfam domain annotations
    string/ids/{accession}.json           UniProt -> STRING id resolution
    string/interactions/{accession}.json  STRING interaction networks

Usage (from a build script)::

    from api_clients import fetch_uniprot_entry, extract_domains

    args = argparse.Namespace(refresh=False, no_network=False)
    entry = fetch_uniprot_entry("P20339", ROOT / "data" / "sources", args)
    domains = extract_domains(entry)

All fetchers raise :class:`ApiError` on failure so callers can degrade
gracefully (log a warning and keep the curated seed data).
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

UNIPROT_BASE = "https://rest.uniprot.org/uniprotkb"
INTERPRO_BASE = "https://www.ebi.ac.uk/interpro/api"
STRING_BASE = "https://string-db.org/api/json"

USER_AGENT = "PathoMap/2.0 (protein enrichment; contact: local development)"

# Minimum seconds between requests per API host (respects provider rate limits)
RATE_LIMITS = {
    "rest.uniprot.org": 0.05,       # ~200 req/s allowed; we go far slower
    "www.ebi.ac.uk": 0.15,          # InterPro/Pfam ~10 req/s
    "string-db.org": 0.25,          # STRING ~5 req/s
}

# Last request timestamp per host, used for throttling
_last_request_at: dict[str, float] = {}


class ApiError(RuntimeError):
    """Raised when an API request fails after retries or is unavailable offline."""


def slug(value: str) -> str:
    """Turn a free-text string into a filesystem-safe cache file name."""
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-") or "empty"


def _host(url: str) -> str:
    return urllib.parse.urlparse(url).netloc


def _throttle(url: str) -> None:
    """Sleep if needed so we stay under the per-host rate limit."""
    host = _host(url)
    interval = RATE_LIMITS.get(host, 0.1)
    now = time.monotonic()
    last = _last_request_at.get(host, 0.0)
    wait = interval - (now - last)
    if wait > 0:
        time.sleep(wait)
    _last_request_at[host] = time.monotonic()


def http_json(
    url: str,
    args: argparse.Namespace,
    cache_path: Optional[Path] = None,
) -> Any:
    """Fetch JSON from ``url`` with on-disk caching and retry logic.

    Reads ``cache_path`` when it exists and ``--refresh`` was not passed.
    Raises ``ApiError`` when ``--no-network`` is set and the cache is missing,
    or when all retry attempts fail.
    """
    refresh = bool(getattr(args, "refresh", False))
    no_network = bool(getattr(args, "no_network", False))

    if cache_path is not None and cache_path.exists() and not refresh:
        try:
            return json.loads(cache_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ApiError(f"invalid JSON in cache {cache_path}: {exc}") from exc

    if no_network:
        raise ApiError(f"network access disabled and cache is missing: {cache_path}")

    last_error: Optional[Exception] = None
    for attempt in range(3):
        try:
            _throttle(url)
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=60) as response:
                text = response.read().decode("utf-8")
            # 204 No Content and other empty bodies mean "no data" (not an error)
            payload = json.loads(text) if text.strip() else {}
            if cache_path is not None:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                cache_path.write_text(
                    json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8",
                )
            return payload
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise ApiError(f"request failed: {url}\n{last_error}")


# ---------------------------------------------------------------------------
# UniProt
# ---------------------------------------------------------------------------

def fetch_uniprot_entry(
    uniprot_id: str, cache_root: Path, args: argparse.Namespace
) -> dict:
    """Fetch the complete UniProt entry for a protein accession."""
    cache_path = cache_root / "uniprot" / "entries" / f"{uniprot_id}.json"
    url = f"{UNIPROT_BASE}/{uniprot_id}.json"
    payload = http_json(url, args, cache_path)
    if not isinstance(payload, dict) or "primaryAccession" not in payload:
        raise ApiError(f"unexpected UniProt response for {uniprot_id}")
    return payload


def fetch_uniprot_sequence(
    uniprot_id: str, cache_root: Path, args: argparse.Namespace
) -> dict:
    """Fetch only the sequence block from UniProt (lighter weight)."""
    cache_path = cache_root / "uniprot" / "sequences" / f"{uniprot_id}.json"
    url = f"{UNIPROT_BASE}/{uniprot_id}.json?fields=sequence"
    payload = http_json(url, args, cache_path)
    if not isinstance(payload, dict):
        raise ApiError(f"unexpected UniProt sequence response for {uniprot_id}")
    return payload


def search_uniprot(
    query: str, organism: str, cache_root: Path, args: argparse.Namespace
) -> list[str]:
    """Search UniProt for accessions matching ``query`` in ``organism``.

    Tries ``query AND organism_name:"organism"`` first, then falls back to
    ``query`` alone so near-miss organism names still resolve.
    """
    cache_dir = cache_root / "uniprot" / "search"
    for attempt, term in enumerate(
        (
            f'{query} AND organism_name:"{organism}"',
            query,
        )
    ):
        cache_path = cache_dir / f"{slug(term)}.json"
        url = (
            f"{UNIPROT_BASE}/search"
            f"?query={urllib.parse.quote(term)}"
            "&fields=accession,protein_name,organism_name&format=json&size=5"
        )
        try:
            data = http_json(url, args, cache_path)
        except ApiError:
            if attempt == 0:
                continue
            raise
        results = data.get("results", []) if isinstance(data, dict) else []
        accessions = [
            r["primaryAccession"]
            for r in results
            if isinstance(r, dict) and r.get("primaryAccession")
        ]
        if accessions:
            return accessions
    return []


# ---------------------------------------------------------------------------
# InterPro / Pfam (domain annotations)
# ---------------------------------------------------------------------------

def _parse_interpro_like(payload: Any) -> list[dict]:
    """Parse InterPro/Pfam API payloads into simple domain records."""
    domains: list[dict] = []
    results = payload.get("results", []) if isinstance(payload, dict) else []
    for result in results:
        metadata = result.get("metadata", {}) or {}
        accession = metadata.get("accession") or metadata.get("id") or ""
        name = metadata.get("name") or metadata.get("description") or accession
        for protein in result.get("proteins", []) or []:
            locations = protein.get("entry_protein_locations") or protein.get("locations") or []
            for location in locations:
                fragments = location.get("fragments") or [location]
                for fragment in fragments:
                    start = fragment.get("start")
                    end = fragment.get("end")
                    domains.append(
                        {
                            "name": name,
                            "accession": accession,
                            "start": start,
                            "end": end,
                        }
                    )
            if not locations:
                domains.append({"name": name, "accession": accession, "start": None, "end": None})
    return domains


def _fetch_interpro_entries(
    uniprot_id: str, source: str, cache_root: Path, args: argparse.Namespace
) -> dict:
    """Fetch the InterPro/Pfam entry matches for a protein.

    The ``/protein/UniProt/{acc}/entry/{source}/`` endpoint returns a wrapper
    document with an ``entries_url`` pointing at the actual match list (and an
    empty body when the protein has no matches), so the wrapper is resolved
    before caching.
    """
    refresh = bool(getattr(args, "refresh", False))
    cache_path = cache_root / source / "matches" / f"{uniprot_id}.json"
    if cache_path.exists() and not refresh:
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ApiError(f"invalid JSON in cache {cache_path}: {exc}") from exc
        # Cached match lists carry "results"; an older wrapper document (with
        # only "entries_url") is stale and gets refreshed below.
        if isinstance(cached, dict) and ("results" in cached or not cached):
            return cached

    wrapper_url = f"{INTERPRO_BASE}/protein/UniProt/{uniprot_id}/entry/{source}/?format=json"
    wrapper = http_json(wrapper_url, args, None)

    payload: dict = {}
    if isinstance(wrapper, dict):
        if wrapper.get("entries_url"):
            entries = http_json(str(wrapper["entries_url"]), args, None)
            payload = entries if isinstance(entries, dict) else {}
        elif wrapper.get("results") is not None:
            payload = wrapper

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return payload


def fetch_interpro_domains(
    uniprot_id: str, cache_root: Path, args: argparse.Namespace
) -> list[dict]:
    """Fetch InterPro domain annotations for a UniProt accession."""
    payload = _fetch_interpro_entries(uniprot_id, "interpro", cache_root, args)
    return _parse_interpro_like(payload)


def fetch_pfam_domains(
    uniprot_id: str, cache_root: Path, args: argparse.Namespace
) -> list[dict]:
    """Fetch Pfam domain annotations for a UniProt accession."""
    payload = _fetch_interpro_entries(uniprot_id, "pfam", cache_root, args)
    return _parse_interpro_like(payload)


# ---------------------------------------------------------------------------
# STRING (protein-protein interactions)
# ---------------------------------------------------------------------------

def _resolve_string_id(
    uniprot_id: str, cache_root: Path, args: argparse.Namespace
) -> Optional[str]:
    """Map a UniProt accession to its STRING protein identifier."""
    cache_path = cache_root / "string" / "ids" / f"{uniprot_id}.json"
    url = f"{STRING_BASE}/get_string_ids?identifiers={uniprot_id}&echo_query=1"
    payload = http_json(url, args, cache_path)
    rows = payload if isinstance(payload, list) else []
    for row in rows:
        if isinstance(row, dict) and row.get("stringId"):
            return str(row["stringId"])
    return None


def fetch_string_interactions(
    uniprot_id: str, cache_root: Path, args: argparse.Namespace
) -> list[dict]:
    """Fetch high-confidence interaction partners from STRING.

    Returns records shaped ``{"string_id", "name", "score"}``. STRING does not
    return UniProt accessions for partners, so the STRING protein identifier is
    stored alongside the preferred (gene) name.
    """
    query_string_id = _resolve_string_id(uniprot_id, cache_root, args)
    if not query_string_id:
        return []

    cache_path = cache_root / "string" / "interactions" / f"{uniprot_id}.json"
    url = f"{STRING_BASE}/network?identifiers={uniprot_id}&required_score=700"
    payload = http_json(url, args, cache_path)
    rows = payload if isinstance(payload, list) else []
    query = query_string_id.upper()
    interactions: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        id_a = str(row.get("stringId_A") or "").upper()
        id_b = str(row.get("stringId_B") or "").upper()
        name_a = str(row.get("preferredName_A") or "")
        name_b = str(row.get("preferredName_B") or "")
        # Keep only edges that touch the queried protein
        if query not in (id_a, id_b):
            continue
        # Skip self-interactions
        if id_a == id_b or name_a.upper() == name_b.upper():
            continue
        if id_b == query:
            partner_id, partner = str(row.get("stringId_A") or ""), name_a
        else:
            partner_id, partner = str(row.get("stringId_B") or ""), name_b
        score = row.get("score")
        interactions.append(
            {
                "string_id": partner_id,
                "name": partner,
                "score": round(float(score), 3) if isinstance(score, (int, float)) else None,
            }
        )
    return interactions


# ---------------------------------------------------------------------------
# Response parsers (UniProt entry -> enriched fields)
# ---------------------------------------------------------------------------

def _location_value(location: dict, key: str) -> Optional[int]:
    raw = (location or {}).get(key)
    if isinstance(raw, dict):
        raw = raw.get("value")
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def extract_domains(entry: dict, include_cross_refs: bool = True) -> list[dict]:
    """Extract domain annotations from a UniProt entry.

    Returns explicit ``Domain`` features (with coordinates) first. When
    ``include_cross_refs`` is set and no features exist, falls back to
    InterPro/Pfam cross-references (which lack coordinates).
    """
    domains: list[dict] = []
    for feature in entry.get("features", []) or []:
        if feature.get("type") != "Domain":
            continue
        location = feature.get("location", {}) or {}
        domains.append(
            {
                "name": feature.get("description") or "Domain",
                "accession": None,
                "start": _location_value(location, "start"),
                "end": _location_value(location, "end"),
            }
        )

    if domains or not include_cross_refs:
        return domains

    for ref in entry.get("uniProtKBCrossReferences", []) or []:
        if ref.get("database") not in ("InterPro", "Pfam"):
            continue
        # UniProt keeps the entry name in properties (e.g. "P-loop_NTPase")
        name = ref.get("description") or ""
        for prop in ref.get("properties", []) or []:
            if prop.get("key") in ("EntryName", "EntryDescription") and prop.get("value"):
                name = prop["value"]
                break
        domains.append(
            {
                "name": name or ref.get("id"),
                "accession": ref.get("id"),
                "start": None,
                "end": None,
            }
        )
    return domains


def extract_go_terms(entry: dict) -> list[dict]:
    """Extract Gene Ontology annotations as ``{id, term, aspect}`` records."""
    go_terms: list[dict] = []
    for ref in entry.get("uniProtKBCrossReferences", []) or []:
        if ref.get("database") != "GO":
            continue
        go_id = ref.get("id")
        term = ""
        aspect = ""
        for prop in ref.get("properties", []) or []:
            if prop.get("key") == "GoTerm":
                raw = prop.get("value", "")
                prefix, _, rest = raw.partition(":")
                if rest:
                    aspect, term = prefix, rest
                else:
                    term = raw
        go_terms.append({"id": go_id, "term": term, "aspect": aspect})
    return go_terms


def extract_pathways(entry: dict) -> list[dict]:
    """Extract KEGG/Reactome pathway memberships from a UniProt entry."""
    pathways: list[dict] = []
    for ref in entry.get("uniProtKBCrossReferences", []) or []:
        database = ref.get("database")
        if database not in ("KEGG", "Reactome"):
            continue
        name = ""
        for prop in ref.get("properties", []) or []:
            key = prop.get("key")
            value = prop.get("value") or ""
            # UniProt uses PathwayName, Description, or Pathway depending on DB
            if key in ("PathwayName", "Pathway", "Description") and value not in ("", "-"):
                name = value
                break
        pathways.append({"database": database, "id": ref.get("id"), "name": name})
    return pathways


def extract_signal_peptide(entry: dict) -> Optional[dict]:
    """Return ``{start, end}`` for the first signal peptide, else ``None``."""
    for feature in entry.get("features", []) or []:
        if feature.get("type") != "Signal":
            continue
        location = feature.get("location", {}) or {}
        return {
            "start": _location_value(location, "start"),
            "end": _location_value(location, "end"),
        }
    return None


def extract_transmembrane_regions(entry: dict) -> list[dict]:
    """Return ``[{start, end}, ...]`` for transmembrane helix features."""
    regions: list[dict] = []
    for feature in entry.get("features", []) or []:
        if feature.get("type") != "Transmembrane":
            continue
        location = feature.get("location", {}) or {}
        regions.append(
            {
                "start": _location_value(location, "start"),
                "end": _location_value(location, "end"),
            }
        )
    return regions


def extract_sequence(entry: dict) -> str:
    """Return the amino acid sequence from a UniProt entry ('' if absent)."""
    sequence = entry.get("sequence") or {}
    return sequence.get("value") or ""

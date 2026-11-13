"""API clients for protein data enrichment.

Provides reusable functions for fetching data from UniProt, InterPro, Pfam,
STRING, and KEGG. Uses the shared http_client module for HTTP infrastructure
including retry logic, rate limiting, and on-disk caching so builds are
reproducible and can run offline with cached responses.

Cache layout (relative to ``data/sources``):

    uniprot/entries/{accession}.json      Full UniProt entries
    uniprot/sequences/{accession}.json    Sequence-only responses
    uniprot/search/{query}.json           Effector name -> accession searches
    interpro/matches/{accession}.json     InterPro domain annotations
    pfam/matches/{accession}.json         Pfam domain annotations
    string/ids/{accession}.json           UniProt -> STRING id resolution
    string/interactions/{accession}.json  STRING interaction networks
    string/network/set_{hash}.json        Combined STRING networks
    kegg/links/{gene}.txt                 KEGG gene -> pathway links
    kegg/pathways_hsa.txt                 KEGG human pathway names

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
import hashlib
import json
import sys
import urllib.parse
from pathlib import Path
from typing import Any, Optional

# Add scripts directory to path for relative imports when run as module
sys.path.insert(0, str(Path(__file__).parent))

from http_client import ApiError, http_json, http_text, slug

UNIPROT_BASE = "https://rest.uniprot.org/uniprotkb"
INTERPRO_BASE = "https://www.ebi.ac.uk/interpro/api"
STRING_BASE = "https://string-db.org/api/json"
KEGG_BASE = "https://rest.kegg.jp"

USER_AGENT = "PathoMap/2.0 (protein enrichment; contact: local development)"


# ---------------------------------------------------------------------------
# UniProt
# ---------------------------------------------------------------------------

def fetch_uniprot_entry(
    uniprot_id: str, cache_root: Path, args: argparse.Namespace
) -> dict:
    """Fetch the complete UniProt entry for a protein accession."""
    cache_path = cache_root / "uniprot" / "entries" / f"{uniprot_id}.json"
    url = f"{UNIPROT_BASE}/{uniprot_id}.json"
    payload = http_json(url, args, cache_path, user_agent=USER_AGENT)
    if not isinstance(payload, dict) or "primaryAccession" not in payload:
        raise ApiError(f"unexpected UniProt response for {uniprot_id}")
    return payload


def fetch_uniprot_sequence(
    uniprot_id: str, cache_root: Path, args: argparse.Namespace
) -> dict:
    """Fetch only the sequence block from UniProt (lighter weight)."""
    cache_path = cache_root / "uniprot" / "sequences" / f"{uniprot_id}.json"
    url = f"{UNIPROT_BASE}/{uniprot_id}.json?fields=sequence"
    payload = http_json(url, args, cache_path, user_agent=USER_AGENT)
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
            data = http_json(url, args, cache_path, user_agent=USER_AGENT)
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
    wrapper = http_json(wrapper_url, args, None, user_agent=USER_AGENT)

    payload: dict = {}
    if isinstance(wrapper, dict):
        if wrapper.get("entries_url"):
            entries = http_json(str(wrapper["entries_url"]), args, None, user_agent=USER_AGENT)
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
    payload = http_json(url, args, cache_path, user_agent=USER_AGENT)
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
    payload = http_json(url, args, cache_path, user_agent=USER_AGENT)
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


def resolve_string_id(
    uniprot_id: str, cache_root: Path, args: argparse.Namespace
) -> Optional[str]:
    """Public wrapper for UniProt -> STRING identifier resolution."""
    return _resolve_string_id(uniprot_id, cache_root, args)


def fetch_string_network_for_ids(
    string_ids: list[str],
    cache_root: Path,
    args: argparse.Namespace,
    *,
    required_score: int = 700,
    species: int = 9606,
) -> list[dict]:
    """Fetch a combined STRING network for resolved STRING identifiers.

    STRING expects identifiers to be newline-separated; a comma-separated
    list returns HTTP 404 for multi-protein queries. The raw response is
    cached on a hash of the sorted identifier set, the score threshold and
    the species, so repeated analysis builds are reproducible and can run
    offline.
    """
    identifiers = sorted({str(item).strip() for item in string_ids if str(item).strip()})
    if not identifiers:
        return []
    fingerprint = hashlib.sha1(
        "|".join([*identifiers, str(required_score), str(species)]).encode("utf-8")
    ).hexdigest()[:16]
    cache_path = cache_root / "string" / "network" / f"set_{fingerprint}.json"
    query = urllib.parse.quote("\r".join(identifiers))
    url = (
        f"{STRING_BASE}/network?identifiers={query}"
        f"&required_score={required_score}&species={species}"
        "&caller_identity=pathomap"
    )
    payload = http_json(url, args, cache_path, user_agent=USER_AGENT)
    return payload if isinstance(payload, list) else []


# ---------------------------------------------------------------------------
# KEGG (UniProt KEGG gene IDs -> KEGG pathways)
# ---------------------------------------------------------------------------

def fetch_kegg_gene_pathways(
    gene_id: str, cache_root: Path, args: argparse.Namespace
) -> list[dict]:
    """Return KEGG pathway links for a KEGG gene identifier such as ``hsa:5868``."""
    gene = str(gene_id or "").strip()
    if not gene:
        return []
    cache_path = cache_root / "kegg" / "links" / f"{slug(gene)}.txt"
    url = f"{KEGG_BASE}/link/pathway/{urllib.parse.quote(gene)}"
    text = http_text(url, args, cache_path, rate_limit=0.34, user_agent=USER_AGENT)
    links: list[dict] = []
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        target = parts[1].strip()
        if target.startswith("path:"):
            target = target[len("path:"):]
        if target:
            links.append({"gene_id": parts[0].strip(), "pathway_id": target})
    return links


def fetch_kegg_pathway_names(
    cache_root: Path, args: argparse.Namespace, *, organism: str = "hsa"
) -> dict[str, str]:
    """Return KEGG pathway IDs -> names for an organism."""
    cache_path = cache_root / "kegg" / f"pathways_{organism}.txt"
    url = f"{KEGG_BASE}/list/pathway/{organism}"
    text = http_text(url, args, cache_path, rate_limit=0.34, user_agent=USER_AGENT)
    names: dict[str, str] = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        pathway_id = parts[0].strip()
        if pathway_id.startswith("path:"):
            pathway_id = pathway_id[len("path:"):]
        names[pathway_id] = parts[1].strip()
    return names


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

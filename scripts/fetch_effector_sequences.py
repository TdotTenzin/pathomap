"""
fetch_effector_sequences.py — Resolve curated effectors to real UniProt sequences.

The curated database stores effector/pathogen *names*, not sequences. This
script maps each effector to a canonical UniProtKB entry and caches the real
amino-acid sequence to `src/pathomap/data/seed/effector_sequences.csv`, together
with the accession and the query that produced it, so the result is auditable
and reproducible.

Matching strategy (gene-only, for precision):
  gene:<alias> AND organism_name:"<pathogen>"
Aliases are split on "/" (e.g. "DrrA/SidM" tries DrrA then SidM) and augmented
with a curated gene map (EFFECTOR_GENE_ALIASES) for effectors whose curated
name is not the UniProt gene symbol (e.g. "EF" -> cya). Within a hit list we
prefer reviewed (Swiss-Prot) entries, then an exact gene-name match, then a
synonym match, then the longest sequence (to avoid fragments). A free-text
fallback was deliberately removed: it produced confidently WRONG matches
(e.g. "LAM" -> an RNA polymerase sigma factor), and a false mapping is worse
than an honest gap.

Effectors that are not polypeptides (NON_PROTEIN_EFFECTORS: "LAM", "Alginate",
"K1 capsule", "LPS", "CPS") are skipped explicitly, since UniProt holds no
sequence for them.

Usage:
    python scripts/fetch_effector_sequences.py [--force] [--limit N] [--only NAME]
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
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "src" / "pathomap" / "data" / "pathomap.db"
OUT_PATH = ROOT / "src" / "pathomap" / "data" / "seed" / "effector_sequences.csv"

SEARCH_URL = "https://rest.uniprot.org/uniprotkb/search"
FIELDS = "accession,id,reviewed,gene_primary,gene_names,protein_name,organism_name,length,sequence"
USER_AGENT = "pathomap-research/0.1 (educational; local use)"

# Definitive NCBI/UniProt taxon renames. The curated DB predates them, so a
# gene lookup under the modern name is required to find the entry.
PATHOGEN_SYNONYMS = {
    "Clostridium difficile": ["Clostridioides difficile"],
    "Rhodococcus equi": ["Rhodococcus hoagii"],
    "Streptomyces scabies": ["Streptomyces scabiei"],
}

# Curated gene symbols for effectors whose curated name is not the UniProt gene
# name. Free-text search was tried first and produced confidently WRONG matches
# (LAM -> sigma factor, LPS -> a kinase), so matching is now gene-only; these
# aliases recover the well-established cases without guessing.
EFFECTOR_GENE_ALIASES = {
    "ef": ["cya"],          # Bacillus anthracis edema factor
    "lf": ["lef"],          # Bacillus anthracis lethal factor
    "pa": ["pagA"],         # Bacillus anthracis protective antigen
    "dt": ["tox"],          # Corynebacterium diphtheriae diphtheria toxin
    "llo": ["hly"],         # Listeria monocytogenes listeriolysin O
    "fha": ["fhaB"],        # Bordetella pertussis filamentous hemagglutinin
    "ptx": ["ptxA"],        # Bordetella pertussis pertussis toxin subunit 1
    "cfp-10": ["esxB"],     # M. tuberculosis CFP-10
    "esat-6": ["esxA"],     # M. tuberculosis ESAT-6
    "tcp": ["tcpA"],        # Vibrio cholerae toxin-coregulated pilus
    "susc": ["susC"],       # Bacteroides fragilis SusC
    "cdt": ["cdtA"],        # Campylobacter jejuni cytolethal distending toxin A
    "sca2": ["sca2"],       # Rickettsia Sca2 autotransporter
    "tlya": ["tlyA"],       # Rickettsia TlyA hemolysin
    "hmw1": ["hmw1A"],      # Haemophilus influenzae HMW1 adhesin
    "hmw2": ["hmw2A"],      # Haemophilus influenzae HMW2 adhesin
    "igle": ["iglE"],       # Francisella tularensis IglE
    "nhe": ["nheA"],        # Bacillus cereus non-hemolytic enterotoxin
    "hbl": ["hblA"],        # Bacillus cereus hemolysin BL binding component
    "spaa": ["spaA"],       # Corynebacterium diphtheriae surface protein SpaA
    "abompa": ["ompA"],     # Acinetobacter baumannii OmpA
    "p5": ["ompP5"],        # Haemophilus influenzae outer membrane protein P5
}

# Effectors that are not polypeptides at all. UniProt holds no sequence for
# them and any "match" would be a fabrication, so they are skipped explicitly.
NON_PROTEIN_EFFECTORS = {
    "lam",          # lipoarabinomannan (glycolipid)
    "lps",          # lipopolysaccharide
    "cps",          # capsular polysaccharide
    "alginate",     # exopolysaccharide
    "k1 capsule",   # polysialic acid capsule
}

CSV_FIELDS = [
    "pathogen_name",
    "effector_name",
    "uniprot_accession",
    "uniprot_entry_name",
    "reviewed",
    "protein_name",
    "organism",
    "sequence_length",
    "matched_query",
    "note",
    "sequence",
]


def _request(url: str, timeout: int = 30, retries: int = 4) -> dict:
    """GET a UniProt JSON endpoint, honouring 429/5xx with backoff."""
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
                retry_after = e.headers.get("Retry-After")
                wait = float(retry_after) if retry_after else delay
                time.sleep(wait)
                delay *= 2
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"UniProt request failed after retries: {last_err}")


def _search(query: str, size: int = 25) -> list[dict]:
    params = {"query": query, "format": "json", "size": size, "fields": FIELDS}
    url = SEARCH_URL + "?" + urllib.parse.urlencode(params)
    data = _request(url)
    return data.get("results", [])


def _alias_candidates(effector_name: str) -> list[str]:
    parts = [p.strip() for p in effector_name.split("/")]
    return [p for p in parts if p]


def _organism_candidates(pathogen_name: str) -> list[str]:
    name = pathogen_name.strip()
    cands: list[str] = []
    for syn in PATHOGEN_SYNONYMS.get(name, []):
        if syn not in cands:
            cands.append(syn)
    if name not in cands:
        cands.append(name)
    tokens = name.split()
    if len(tokens) > 2:
        two = " ".join(tokens[:2])
        if two not in cands:
            cands.append(two)
    return cands


def _all_gene_names(entry: dict) -> list[str]:
    names: list[str] = []
    for g in entry.get("genes", []):
        gn = g.get("geneName", {}).get("value")
        if gn:
            names.append(gn)
        for syn in g.get("synonyms", []):
            v = syn.get("value")
            if v:
                names.append(v)
        for orf in g.get("orfNames", []):
            v = orf.get("value")
            if v:
                names.append(v)
    return names


def _is_reviewed(entry: dict) -> bool:
    return str(entry.get("entryType", "")).lower().startswith("uniprotkb reviewed")


def _protein_name(entry: dict) -> str | None:
    desc = entry.get("proteinDescription", {})
    rec = desc.get("recommendedName", {}).get("fullName", {}).get("value")
    if rec:
        return rec
    subs = desc.get("submissionNames", [])
    if subs:
        return subs[0].get("fullName", {}).get("value")
    return None


def _rank_key(entry: dict, alias: str):
    a = alias.lower()
    primary = [
        g.get("geneName", {}).get("value", "").lower()
        for g in entry.get("genes", [])
        if g.get("geneName")
    ]
    allnames = [n.lower() for n in _all_gene_names(entry)]
    length = entry.get("sequence", {}).get("length", 0) or 0
    return (
        1 if _is_reviewed(entry) else 0,
        1 if a in primary else 0,
        1 if a in allnames else 0,
        length,
    )


def resolve_effector(pathogen_name: str, effector_name: str) -> dict | None:
    """Return a best-match record for one effector, or None if nothing sensible.

    Matching is gene-only. A free-text fallback was removed because it produced
    confidently wrong matches (e.g. "LAM" -> an RNA polymerase sigma factor).
    """
    if effector_name.strip().lower() in NON_PROTEIN_EFFECTORS:
        return None

    aliases = _alias_candidates(effector_name)
    curated = EFFECTOR_GENE_ALIASES.get(effector_name.strip().lower(), [])
    gene_candidates = aliases + [g for g in curated if g not in aliases]
    organisms = _organism_candidates(pathogen_name)

    best: tuple[tuple, dict, str] | None = None
    for alias in gene_candidates:
        for organism in organisms:
            attempt = f'gene:{alias} AND organism_name:"{organism}"'
            try:
                hits = _search(attempt)
            except Exception as e:  # noqa: BLE001
                print(f"    ! query error ({attempt}): {e}")
                hits = []
            time.sleep(0.2)
            if not hits:
                continue
            ranked = sorted(hits, key=lambda r: _rank_key(r, alias), reverse=True)
            top = ranked[0]
            key = _rank_key(top, alias)
            if best is None or key > best[0]:
                best = (key, top, attempt)
            break  # first organism with hits wins for this alias
        if best is not None and best[0][0] == 1 and best[0][1] == 1:
            break  # reviewed + exact gene match is good enough

    if best is None:
        return None

    _, entry, query = best
    seq = entry.get("sequence", {}).get("value", "")
    if not seq:
        return None
    return {
        "pathogen_name": pathogen_name,
        "effector_name": effector_name,
        "uniprot_accession": entry.get("primaryAccession", ""),
        "uniprot_entry_name": entry.get("uniProtkbId", ""),
        "reviewed": _is_reviewed(entry),
        "protein_name": _protein_name(entry) or "",
        "organism": entry.get("organism", {}).get("scientificName", ""),
        "sequence_length": len(seq),
        "matched_query": query,
        "note": "",
        "sequence": seq,
    }


def load_effectors() -> list[tuple[str, str]]:
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT p.name, e.name FROM effectors e JOIN pathogens p ON e.pathogen_id = p.id "
        "ORDER BY p.name, e.name"
    ).fetchall()
    conn.close()
    return [(r[0], r[1]) for r in rows]


def load_existing() -> dict[tuple[str, str], dict]:
    if not OUT_PATH.exists():
        return {}
    with OUT_PATH.open("r", newline="", encoding="utf-8") as f:
        return {(r["pathogen_name"], r["effector_name"]): r for r in csv.DictReader(f)}


def write_rows(rows: list[dict]) -> None:
    rows = sorted(rows, key=lambda r: (r["pathogen_name"], r["effector_name"]))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="refetch every effector")
    ap.add_argument("--limit", type=int, default=None, help="only process the first N effectors")
    ap.add_argument("--only", default=None, help="only effectors whose pathogen contains this text")
    args = ap.parse_args()

    effectors = load_effectors()
    if args.only:
        effectors = [e for e in effectors if args.only.lower() in e[0].lower()]
    if args.limit:
        effectors = effectors[: args.limit]

    existing = load_existing()
    rows: list[dict] = []
    resolved = skipped = 0

    def _placeholder(pathogen: str, effector: str, note: str) -> dict:
        return {field: "" for field in CSV_FIELDS} | {
            "pathogen_name": pathogen,
            "effector_name": effector,
            "note": note,
        }

    for i, (pathogen, effector) in enumerate(effectors, 1):
        key = (pathogen, effector)
        if not args.force and key in existing:
            rec = existing[key]
            rows.append(rec)
            if rec.get("sequence"):
                resolved += 1
            else:
                skipped += 1
            continue

        print(f"[{i}/{len(effectors)}] {pathogen} :: {effector}")
        try:
            rec = resolve_effector(pathogen, effector)
        except Exception as e:  # noqa: BLE001
            print(f"    ! failed: {e}")
            rec = None

        if rec is None:
            if effector.strip().lower() in NON_PROTEIN_EFFECTORS:
                note = "non-protein effector; no polypeptide sequence exists"
                print("    - non-protein effector (skipped)")
            else:
                note = "no confident UniProt gene match"
                print("    - no confident UniProt match (skipped)")
            rows.append(_placeholder(pathogen, effector, note))
            skipped += 1
        else:
            rows.append(rec)
            resolved += 1
            flag = "reviewed" if rec["reviewed"] else "unreviewed"
            print(f"    + {rec['uniprot_accession']} ({flag}, {rec['sequence_length']} aa) {rec['protein_name']}")

        # Persist after every effector so the run is resumable if interrupted.
        write_rows(rows)

    write_rows(rows)
    print(f"\nWrote {len(rows)} effectors ({resolved} resolved) to {OUT_PATH.relative_to(ROOT)}")
    print(f"Resolved: {resolved}  Unmapped: {skipped}  (of {len(effectors)} considered)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

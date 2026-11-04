#!/usr/bin/env python3
"""Build the PathoMap pathogens table.

The curated seed in ``data/sources/pathogens_seed.json`` is enriched with
NCBI Taxonomy and NCBI Datasets (representative genome) data, validated, and
written to:

  data/pathomap-dataset.json
  data/sample-dataset.json
  data/pathomap.db
  data/schema.sql
  data/schema/pathogens.schema.json

Usage:
  python scripts/build_pathogens.py
  python scripts/build_pathogens.py --check
  python scripts/build_pathogens.py --refresh
  python scripts/build_pathogens.py --no-network
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "data" / "sources" / "pathogens_seed.json"
OVERRIDES_PATH = ROOT / "data" / "sources" / "pathogen_overrides.json"
CACHE_DIR = ROOT / "data" / "sources" / "ncbi"
DATASET_PATH = ROOT / "data" / "pathomap-dataset.json"
SAMPLE_PATH = ROOT / "data" / "sample-dataset.json"
DB_PATH = ROOT / "data" / "pathomap.db"
SQL_PATH = ROOT / "data" / "schema.sql"
JSON_SCHEMA_PATH = ROOT / "data" / "schema" / "pathogens.schema.json"

SCHEMA_VERSION = "2.0"
DATASET_NAME = "pathomap"

GRAM_STAIN_VALUES = ["Gram-positive", "Gram-negative", "Gram-variable", "unknown"]
STRATEGY_VALUES = [
    "arrest",
    "escape",
    "reroute",
    "modified_compartment",
    "extracellular",
    "unknown",
]
ASSEMBLY_LEVEL_VALUES = ["Complete Genome", "Chromosome", "Scaffold", "Contig", "unknown"]
CURATION_STATUS_VALUES = ["curated", "needs_review"]

COLUMNS = [
    "pathogen_id",
    "name",
    "genus",
    "species",
    "serovar",
    "strain",
    "tax_id",
    "ncbi_scientific_name",
    "family",
    "order_name",
    "class_name",
    "phylum",
    "gram_stain",
    "acid_fast",
    "strategy",
    "strategy_secondary",
    "strategy_evidence",
    "intracellular_niche",
    "genome_accession",
    "assembly_level",
    "genome_size_mb",
    "gc_content",
    "n_contigs",
    "reference_doi",
    "description",
    "curation_notes",
    "curation_status",
    "last_updated",
]

SAMPLE_IDS = [1, 3, 13, 32, 48]

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
DATASETS = "https://api.ncbi.nlm.nih.gov/datasets/v2alpha"
USER_AGENT = "PathoMap/2.0 (curated pathogens build; contact: local development)"


class BuildError(RuntimeError):
    pass


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def slug(value: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")


def http_text(url: str, args: argparse.Namespace, cache_path: Path | None = None) -> str:
    if cache_path and cache_path.exists() and not args.refresh:
        return cache_path.read_text(encoding="utf-8")
    if args.no_network:
        raise BuildError(f"network access disabled and cache is missing: {cache_path}")

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as response:
                text = response.read().decode("utf-8")
            time.sleep(0.34)
            if cache_path:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                cache_path.write_text(text, encoding="utf-8")
            return text
        except Exception as exc:  # noqa: BLE001 - retried below
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise BuildError(f"request failed: {url}\n{last_error}")


def http_json(url: str, args: argparse.Namespace, cache_path: Path | None = None) -> dict:
    text = http_text(url, args, cache_path)
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise BuildError(f"invalid JSON from {url}: {exc}") from exc


def taxonomy_search(
    name: str, pathogen_id: int, args: argparse.Namespace, tax_name: str | None = None
) -> int:
    candidates: list[str] = []
    for candidate in (tax_name, name, " ".join(name.split()[:2])):
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    last_cache: Path | None = None
    for candidate in candidates:
        cache = CACHE_DIR / "taxonomy_search" / f"{pathogen_id}-{slug(candidate)}.json"
        last_cache = cache
        term = urllib.parse.quote(candidate)
        url = f"{EUTILS}/esearch.fcgi?db=taxonomy&term={term}&retmode=json&retmax=10"
        payload = http_json(url, args, cache)
        ids = payload.get("esearchresult", {}).get("idlist", [])
        if ids:
            return int(ids[0])
    raise BuildError(
        f"no NCBI Taxonomy match for {name!r} (pathogen_id {pathogen_id}); "
        f"tried {candidates}. Add a `tax_name` or `tax_id` override."
    )


def parse_taxonomy_xml(text: str) -> dict[int, dict]:
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise BuildError(f"invalid taxonomy XML: {exc}") from exc
    parsed: dict[int, dict] = {}
    for taxon in root.findall("Taxon"):
        tax_id = int(taxon.findtext("TaxId", ""))
        lineage = []
        for ancestor in taxon.findall("./LineageEx/Taxon"):
            lineage.append(
                {
                    "tax_id": int(ancestor.findtext("TaxId", "0") or 0),
                    "name": ancestor.findtext("ScientificName", ""),
                    "rank": ancestor.findtext("Rank", ""),
                }
            )
        parsed[tax_id] = {
            "tax_id": tax_id,
            "scientificname": taxon.findtext("ScientificName", ""),
            "rank": taxon.findtext("Rank", ""),
            "lineageex": lineage,
        }
    return parsed


def taxonomy_summaries(tax_ids: set[int], args: argparse.Namespace) -> dict[int, dict]:
    summaries: dict[int, dict] = {}
    missing: list[int] = []
    for tax_id in sorted(tax_ids):
        cache = CACHE_DIR / "taxonomy" / f"{tax_id}.json"
        if cache.exists() and not args.refresh:
            cached = read_json(cache)
            if cached.get("lineageex"):
                summaries[tax_id] = cached
                continue
        missing.append(tax_id)

    for start in range(0, len(missing), 50):
        chunk = missing[start : start + 50]
        ids = ",".join(str(t) for t in chunk)
        url = f"{EUTILS}/efetch.fcgi?db=taxonomy&id={ids}&retmode=xml"
        batch_cache = CACHE_DIR / "taxonomy" / "batches" / f"{chunk[0]}-{chunk[-1]}.xml"
        text = http_text(url, args, batch_cache)
        parsed = parse_taxonomy_xml(text)
        for tax_id in chunk:
            item = parsed.get(tax_id)
            if not item:
                raise BuildError(f"no taxonomy record for tax_id {tax_id}")
            cache = CACHE_DIR / "taxonomy" / f"{tax_id}.json"
            write_json(cache, item)
            summaries[tax_id] = item
    return summaries


def lineage_fields(summary: dict) -> dict[str, str]:
    fields = {"family": "", "order_name": "", "class_name": "", "phylum": ""}
    for item in summary.get("lineageex", []):
        rank = item.get("rank", "")
        if rank == "family":
            fields["family"] = item.get("name", "")
        elif rank == "order":
            fields["order_name"] = item.get("name", "")
        elif rank == "class":
            fields["class_name"] = item.get("name", "")
        elif rank == "phylum":
            fields["phylum"] = item.get("name", "")
    return fields


def report_rank(report: dict) -> tuple:
    info = report.get("assembly_info", {})
    level = info.get("assembly_level", "")
    level_rank = {
        "Complete Genome": 0,
        "Chromosome": 1,
        "Scaffold": 2,
        "Contig": 3,
    }.get(level, 4)
    accession = report.get("accession", "")
    source_rank = 0 if accession.startswith("GCF_") else 1
    category = info.get("refseq_category") or ""
    category_rank = 0 if category == "reference genome" else 1 if category == "representative genome" else 2
    return (level_rank, category_rank, source_rank, accession)


def choose_report(payload: dict) -> dict | None:
    reports = payload.get("reports") or []
    current = [
        r
        for r in reports
        if (r.get("assembly_info", {}).get("assembly_status") or "current") == "current"
    ]
    pool = current or reports
    if not pool:
        return None
    return sorted(pool, key=report_rank)[0]


def genome_report(tax_id: int, pathogen_id: int, args: argparse.Namespace) -> dict | None:
    cache = CACHE_DIR / "genomes" / f"{pathogen_id}-{tax_id}.json"
    cached: dict = {}
    if cache.exists() and not args.refresh:
        cached = read_json(cache)
        selected = cached.get("selected")
        if selected and selected.get("assembly_info", {}).get("assembly_level") == "Complete Genome":
            return selected
        if cached.get("evaluated_refseq") and "selected" in cached:
            return selected

    pool: list[dict] = []
    queries: list[str] = []
    selected = cached.get("selected")
    if selected:
        pool.append(selected)
        queries.append("cached")
    else:
        reference_cache = CACHE_DIR / "genomes" / f"{pathogen_id}-{tax_id}-reference.json"
        reference_url = f"{DATASETS}/genome/taxon/{tax_id}/dataset_report?filters.reference_only=true"
        try:
            reference_payload = http_json(reference_url, args, reference_cache)
            reference = choose_report(reference_payload)
            if reference:
                pool.append(reference)
                queries.append("reference_only")
                if reference.get("assembly_info", {}).get("assembly_level") == "Complete Genome":
                    write_json(
                        cache,
                        {
                            "tax_id": tax_id,
                            "queries": queries,
                            "evaluated_refseq": False,
                            "selected": reference,
                        },
                    )
                    return reference
        except BuildError:
            pass

    evaluated = False
    refseq_cache = CACHE_DIR / "genomes" / f"{pathogen_id}-{tax_id}-refseq.json"
    refseq_url = (
        f"{DATASETS}/genome/taxon/{tax_id}/dataset_report"
        "?filters.assembly_source=refseq&page_size=100"
    )
    try:
        refseq_payload = http_json(refseq_url, args, refseq_cache)
        pool.extend(refseq_payload.get("reports") or [])
        queries.append("refseq")
        evaluated = True
    except BuildError:
        pass

    if not pool:
        all_cache = CACHE_DIR / "genomes" / f"{pathogen_id}-{tax_id}-all.json"
        all_url = f"{DATASETS}/genome/taxon/{tax_id}/dataset_report?page_size=100"
        try:
            all_payload = http_json(all_url, args, all_cache)
            pool.extend(all_payload.get("reports") or [])
            queries.append("all")
            evaluated = True
        except BuildError:
            pass

    best = choose_report({"reports": pool}) if pool else None
    write_json(
        cache,
        {
            "tax_id": tax_id,
            "queries": queries,
            "evaluated_refseq": evaluated,
            "selected": best,
        },
    )
    return best


def genome_report_by_accession(
    accession: str, pathogen_id: int, args: argparse.Namespace
) -> dict:
    """Fetch metadata for an explicitly curated assembly accession.

    Use this for strain-specific pathogen records where a species-level
    taxonomy lookup could otherwise select a different strain's genome.
    """
    cache = CACHE_DIR / "genomes" / f"{pathogen_id}-accession-{slug(accession)}.json"
    url = f"{DATASETS}/genome/accession/{urllib.parse.quote(accession, safe='')}/dataset_report"
    payload = http_json(url, args, cache)
    reports = payload.get("reports") or []
    report = next((item for item in reports if item.get("accession") == accession), None)
    if report is None and len(reports) == 1:
        report = reports[0]
    if report is None:
        raise BuildError(
            f"NCBI Datasets did not return the explicitly requested assembly "
            f"{accession!r} for pathogen_id {pathogen_id}"
        )
    returned_accession = report.get("accession")
    if returned_accession and returned_accession != accession:
        raise BuildError(
            f"NCBI returned {returned_accession!r} for requested accession {accession!r}"
        )
    return report


def build_rows(args: argparse.Namespace) -> list[dict]:
    seed = read_json(SEED_PATH)["pathogens"]
    overrides = read_json(OVERRIDES_PATH).get("pathogens", {}) if OVERRIDES_PATH.exists() else {}

    resolved: list[dict] = []
    tax_ids: set[int] = set()
    for entry in seed:
        pid = int(entry["pathogen_id"])
        override = overrides.get(str(pid), {})
        tax_id = override.get("tax_id")
        if tax_id is None:
            tax_id = taxonomy_search(entry["name"], pid, args, entry.get("tax_name"))
        tax_id = int(tax_id)
        tax_ids.add(tax_id)
        resolved.append({"seed": entry, "override": override, "tax_id": tax_id})

    summaries = taxonomy_summaries(tax_ids, args)
    today = dt.date.today().isoformat()
    rows: list[dict] = []

    for item in resolved:
        seed = item["seed"]
        override = item["override"]
        tax_id = item["tax_id"]
        summary = summaries[tax_id]
        lineage = lineage_fields(summary)

        pinned_accession = override.get("genome_accession")
        if pinned_accession:
            report = genome_report_by_accession(
                str(pinned_accession), int(seed["pathogen_id"]), args
            )
        else:
            report = genome_report(tax_id, int(seed["pathogen_id"]), args)
        if report:
            info = report.get("assembly_info", {})
            stats = report.get("assembly_stats", {})
            total_length = stats.get("total_sequence_length")
            genome_size_mb = round(float(total_length) / 1_000_000, 2) if total_length else None
            gc_content = stats.get("gc_percent")
            gc_content = round(float(gc_content), 1) if gc_content is not None else None
            n_contigs = stats.get("number_of_contigs")
            n_contigs = int(n_contigs) if n_contigs is not None else None
            genome_accession = report.get("accession")
            assembly_level = info.get("assembly_level") or "unknown"
        else:
            genome_accession = None
            assembly_level = "unknown"
            genome_size_mb = None
            gc_content = None
            n_contigs = None

        row = {
            "pathogen_id": int(seed["pathogen_id"]),
            "name": seed["name"],
            "genus": seed["genus"],
            "species": seed["species"],
            "serovar": seed.get("serovar") or None,
            "strain": seed.get("strain") or None,
            "tax_id": tax_id,
            "ncbi_scientific_name": summary.get("scientificname", ""),
            "family": lineage["family"],
            "order_name": lineage["order_name"],
            "class_name": lineage["class_name"],
            "phylum": lineage["phylum"],
            "gram_stain": seed["gram_stain"],
            "acid_fast": bool(seed["acid_fast"]),
            "strategy": seed["strategy"],
            "strategy_secondary": seed.get("strategy_secondary") or None,
            "strategy_evidence": seed.get("strategy_evidence") or None,
            "intracellular_niche": seed.get("intracellular_niche") or None,
            "genome_accession": genome_accession,
            "assembly_level": assembly_level,
            "genome_size_mb": genome_size_mb,
            "gc_content": gc_content,
            "n_contigs": n_contigs,
            "reference_doi": seed["reference_doi"],
            "description": seed["description"],
            "curation_notes": seed.get("curation_notes") or None,
            "curation_status": "curated",
            "last_updated": today,
        }
        row.update({k: v for k, v in override.items() if k in COLUMNS and k != "pathogen_id"})
        if row["assembly_level"] == "unknown" or any(
            row.get(k) is None
            for k in ("genome_accession", "genome_size_mb", "gc_content", "n_contigs")
        ):
            row["curation_status"] = "needs_review"
        if any(not row.get(k) for k in ("family", "order_name", "class_name", "phylum")):
            row["curation_status"] = "needs_review"
        rows.append({k: row.get(k) for k in COLUMNS})

    rows.sort(key=lambda r: r["pathogen_id"])
    return rows


def validate_rows(rows: list[dict]) -> list[str]:
    errors: list[str] = []
    seen_ids: set[int] = set()
    seen_names: set[str] = set()
    seen_tax: set[int] = set()

    required = [
        "pathogen_id",
        "name",
        "genus",
        "species",
        "tax_id",
        "ncbi_scientific_name",
        "family",
        "order_name",
        "class_name",
        "phylum",
        "gram_stain",
        "strategy",
        "curation_status",
        "last_updated",
        "reference_doi",
        "description",
    ]

    for index, row in enumerate(rows):
        label = f"row {index} ({row.get('name', '?')})"
        for key in required:
            value = row.get(key)
            if value is None or (isinstance(value, str) and not value.strip()):
                errors.append(f"{label}: missing required field {key}")
        pid = row.get("pathogen_id")
        if not isinstance(pid, int) or pid <= 0:
            errors.append(f"{label}: pathogen_id must be a positive integer")
        elif pid in seen_ids:
            errors.append(f"{label}: duplicate pathogen_id {pid}")
        else:
            seen_ids.add(pid)
        name = row.get("name")
        if isinstance(name, str):
            if name in seen_names:
                errors.append(f"{label}: duplicate name {name!r}")
            seen_names.add(name)
        tax_id = row.get("tax_id")
        if not isinstance(tax_id, int) or tax_id <= 0:
            errors.append(f"{label}: tax_id must be a positive integer")
        elif tax_id in seen_tax:
            errors.append(f"{label}: duplicate tax_id {tax_id}")
        else:
            seen_tax.add(tax_id)
        if row.get("gram_stain") not in GRAM_STAIN_VALUES:
            errors.append(f"{label}: invalid gram_stain {row.get('gram_stain')!r}")
        if not isinstance(row.get("acid_fast"), bool):
            errors.append(f"{label}: acid_fast must be a boolean")
        if row.get("strategy") not in STRATEGY_VALUES:
            errors.append(f"{label}: invalid strategy {row.get('strategy')!r}")
        if row.get("assembly_level") not in ASSEMBLY_LEVEL_VALUES:
            errors.append(f"{label}: invalid assembly_level {row.get('assembly_level')!r}")
        if row.get("curation_status") not in CURATION_STATUS_VALUES:
            errors.append(f"{label}: invalid curation_status {row.get('curation_status')!r}")
        doi = row.get("reference_doi")
        if not isinstance(doi, str) or not doi.startswith("10."):
            errors.append(f"{label}: reference_doi must be a DOI starting with 10.")
        try:
            dt.date.fromisoformat(row.get("last_updated", ""))
        except ValueError:
            errors.append(f"{label}: last_updated must be an ISO date")

        curated = row.get("curation_status") == "curated"
        size = row.get("genome_size_mb")
        gc = row.get("gc_content")
        contigs = row.get("n_contigs")
        if curated:
            if not row.get("genome_accession"):
                errors.append(f"{label}: curated row needs genome_accession")
            if row.get("assembly_level") == "unknown":
                errors.append(f"{label}: curated row needs a known assembly_level")
            if not isinstance(size, (int, float)):
                errors.append(f"{label}: curated row needs numeric genome_size_mb")
            if not isinstance(gc, (int, float)):
                errors.append(f"{label}: curated row needs numeric gc_content")
            if not isinstance(contigs, int):
                errors.append(f"{label}: curated row needs integer n_contigs")
        if isinstance(size, (int, float)) and not (0.1 <= size <= 20):
            errors.append(f"{label}: genome_size_mb out of range ({size})")
        if isinstance(gc, (int, float)) and not (10 <= gc <= 90):
            errors.append(f"{label}: gc_content out of range ({gc})")
        if isinstance(contigs, int) and contigs < 1:
            errors.append(f"{label}: n_contigs must be >= 1")

    return errors


def dataset_payload(rows: list[dict]) -> dict:
    return {
        "meta": {
            "dataset": DATASET_NAME,
            "schema_version": SCHEMA_VERSION,
            "built_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "tables": {"pathogens": len(rows)},
            "sources": {
                "curation": "data/sources/pathogens_seed.json",
                "overrides": "data/sources/pathogen_overrides.json",
                "ncbi_taxonomy": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
                "ncbi_datasets": "https://api.ncbi.nlm.nih.gov/datasets/v2alpha/",
            },
        },
        "pathogens": rows,
    }


def write_schema_sql() -> None:
    sql = """-- PathoMap v2 pathogens schema
CREATE TABLE pathogens (
  pathogen_id        INTEGER PRIMARY KEY,
  name               TEXT    NOT NULL UNIQUE,
  genus              TEXT    NOT NULL,
  species            TEXT    NOT NULL,
  serovar            TEXT,
  strain             TEXT,
  tax_id             INTEGER NOT NULL UNIQUE,
  ncbi_scientific_name TEXT NOT NULL,
  family             TEXT    NOT NULL,
  order_name         TEXT    NOT NULL,
  class_name         TEXT    NOT NULL,
  phylum             TEXT    NOT NULL,
  gram_stain         TEXT    NOT NULL CHECK (gram_stain IN ('Gram-positive', 'Gram-negative', 'Gram-variable', 'unknown')),
  acid_fast          INTEGER NOT NULL CHECK (acid_fast IN (0, 1)),
  strategy           TEXT    NOT NULL CHECK (strategy IN ('arrest', 'escape', 'reroute', 'modified_compartment', 'extracellular', 'unknown')),
  strategy_secondary TEXT,
  strategy_evidence  TEXT,
  intracellular_niche TEXT,
  genome_accession   TEXT,
  assembly_level     TEXT    NOT NULL CHECK (assembly_level IN ('Complete Genome', 'Chromosome', 'Scaffold', 'Contig', 'unknown')),
  genome_size_mb     REAL,
  gc_content         REAL,
  n_contigs          INTEGER,
  reference_doi      TEXT    NOT NULL,
  description        TEXT    NOT NULL,
  curation_notes     TEXT,
  curation_status    TEXT    NOT NULL CHECK (curation_status IN ('curated', 'needs_review')),
  last_updated       TEXT    NOT NULL
);

CREATE INDEX idx_pathogens_strategy ON pathogens(strategy);
CREATE INDEX idx_pathogens_gram_stain ON pathogens(gram_stain);
CREATE INDEX idx_pathogens_tax_id ON pathogens(tax_id);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""
    SQL_PATH.write_text(sql, encoding="utf-8")


def write_sqlite(rows: list[dict]) -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()
    con = sqlite3.connect(DB_PATH)
    try:
        con.executescript(SQL_PATH.read_text(encoding="utf-8"))
        placeholders = ", ".join("?" for _ in COLUMNS)
        columns = ", ".join(COLUMNS)
        con.executemany(
            f"INSERT INTO pathogens ({columns}) VALUES ({placeholders})",
            [
                tuple(
                    int(row["acid_fast"]) if key == "acid_fast" else row[key]
                    for key in COLUMNS
                )
                for row in rows
            ],
        )
        meta = {
            "dataset": DATASET_NAME,
            "schema_version": SCHEMA_VERSION,
            "built_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "pathogen_count": str(len(rows)),
        }
        con.executemany("INSERT INTO meta (key, value) VALUES (?, ?)", meta.items())
        con.commit()
    finally:
        con.close()


def write_json_schema() -> None:
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://pathomap.local/schema/pathogens.schema.json",
        "title": "PathoMap pathogens dataset",
        "type": "object",
        "additionalProperties": False,
        "required": ["meta", "pathogens"],
        "properties": {
            "meta": {
                "type": "object",
                "required": ["dataset", "schema_version", "tables"],
                "properties": {
                    "dataset": {"type": "string"},
                    "schema_version": {"type": "string"},
                    "built_at": {"type": "string"},
                    "tables": {"type": "object"},
                    "sources": {"type": "object"},
                },
            },
            "pathogens": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": COLUMNS,
                    "properties": {
                        "pathogen_id": {"type": "integer", "minimum": 1},
                        "name": {"type": "string", "minLength": 1},
                        "genus": {"type": "string", "minLength": 1},
                        "species": {"type": "string", "minLength": 1},
                        "serovar": {"type": ["string", "null"]},
                        "strain": {"type": ["string", "null"]},
                        "tax_id": {"type": "integer", "minimum": 1},
                        "ncbi_scientific_name": {"type": "string", "minLength": 1},
                        "family": {"type": "string", "minLength": 1},
                        "order_name": {"type": "string", "minLength": 1},
                        "class_name": {"type": "string", "minLength": 1},
                        "phylum": {"type": "string", "minLength": 1},
                        "gram_stain": {"enum": GRAM_STAIN_VALUES},
                        "acid_fast": {"type": "boolean"},
                        "strategy": {"enum": STRATEGY_VALUES},
                        "strategy_secondary": {"type": ["string", "null"]},
                        "strategy_evidence": {"type": ["string", "null"]},
                        "intracellular_niche": {"type": ["string", "null"]},
                        "genome_accession": {"type": ["string", "null"]},
                        "assembly_level": {"enum": ASSEMBLY_LEVEL_VALUES},
                        "genome_size_mb": {"type": ["number", "null"], "minimum": 0.1, "maximum": 20},
                        "gc_content": {"type": ["number", "null"], "minimum": 10, "maximum": 90},
                        "n_contigs": {"type": ["integer", "null"], "minimum": 1},
                        "reference_doi": {"type": "string", "pattern": "^10\\."},
                        "description": {"type": "string", "minLength": 1},
                        "curation_notes": {"type": ["string", "null"]},
                        "curation_status": {"enum": CURATION_STATUS_VALUES},
                        "last_updated": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
                    },
                },
            },
        },
    }
    write_json(JSON_SCHEMA_PATH, schema)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate without writing output files")
    parser.add_argument("--refresh", action="store_true", help="ignore cached NCBI responses")
    parser.add_argument("--no-network", action="store_true", help="use cache only")
    args = parser.parse_args()

    if not SEED_PATH.exists():
        print(f"error: missing seed file {SEED_PATH}", file=sys.stderr)
        return 1

    try:
        rows = build_rows(args)
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    errors = validate_rows(rows)
    review = [r for r in rows if r["curation_status"] == "needs_review"]
    print(f"pathogens: {len(rows)}")
    print(f"needs review: {len(review)}")
    for row in review:
        print(f"  - {row['pathogen_id']}: {row['name']} (tax_id {row['tax_id']})")
    if errors:
        print(f"validation errors: {len(errors)}", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print("validation: ok")

    if args.check:
        return 0

    payload = dataset_payload(rows)
    write_json(DATASET_PATH, payload)
    write_json(SAMPLE_PATH, dataset_payload([r for r in rows if r["pathogen_id"] in SAMPLE_IDS]))
    write_schema_sql()
    write_json_schema()
    write_sqlite(rows)
    print(f"wrote {DATASET_PATH.relative_to(ROOT)}")
    print(f"wrote {SAMPLE_PATH.relative_to(ROOT)}")
    print(f"wrote {DB_PATH.relative_to(ROOT)}")
    print(f"wrote {SQL_PATH.relative_to(ROOT)}")
    print(f"wrote {JSON_SCHEMA_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

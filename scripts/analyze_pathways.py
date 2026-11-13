#!/usr/bin/env python3
"""Reactome and KEGG pathway representation and over-representation analysis.

Reactome memberships come from curated host-protein annotations. Stored KEGG
identifiers are gene IDs, so they are mapped to KEGG pathways through the KEGG
REST API and cached under ``data/sources/kegg``.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analysis_common import (
    ROOT,
    bh_adjust,
    count_issue_codes,
    hypergeom_sf,
    issue,
    issue_sort_key,
    provenance_meta,
    read_dataset,
    round_or_none,
    status_from_reasons,
    table_rows,
    write_json_atomic,
)
from api_clients import ApiError, fetch_kegg_gene_pathways, fetch_kegg_pathway_names

ANALYSIS_VERSION = "1.0"
OUTPUT_SCHEMA_VERSION = "1.0"
OUTPUT_PATH = ROOT / "data" / "derived" / "pathway_analysis.json"
DATASET_PATH = ROOT / "data" / "pathomap-dataset.json"
CACHE_ROOT = ROOT / "data" / "sources"
PARAMETERS = {
    "test": "one-sided hypergeometric over-representation",
    "multiple_testing": "Benjamini-Hochberg within database",
    "significance_threshold": 0.05,
    "min_background_pathway_size": 2,
    "min_foreground_overlap": 1,
    "minimum_foreground_size": 3,
    "low_power_foreground_size": 10,
    "low_power_background_size": 20,
    "background": "all host proteins with pathway annotations",
    "foreground": "host proteins in retained curated interactions",
    "kegg_source": "https://rest.kegg.jp",
    "kegg_species_prefix": "hsa:",
}
INPUT_TABLES = ["host_proteins", "interactions"]


def pathway_rows(row: dict) -> list[dict]:
    result = []
    for pathway in row.get("pathways_detailed") or []:
        if not isinstance(pathway, dict):
            continue
        database = pathway.get("database")
        pathway_id = pathway.get("id")
        if database not in ("Reactome", "KEGG") or not pathway_id:
            continue
        result.append({
            "database": database,
            "id": str(pathway_id),
            "name": pathway.get("name") or "",
        })
    return result


def enrich_database(
    *,
    database: str,
    proteins_by_pathway: dict[str, set[str]],
    names: dict[str, str],
    foreground_ids: set[str],
    background_ids: set[str],
) -> dict:
    background = background_ids
    foreground = foreground_ids & background
    tested = []
    for pathway_id, proteins in proteins_by_pathway.items():
        background_count = len(proteins & background)
        foreground_count = len(proteins & foreground)
        if background_count < 2 or foreground_count < 1:
            continue
        p_value = hypergeom_sf(
            foreground_count,
            len(background),
            background_count,
            len(foreground),
        )
        fold = None
        if foreground and background and background_count:
            fold = (foreground_count / len(foreground)) / (background_count / len(background))
        tested.append({
            "pathway_id": pathway_id,
            "pathway_name": names.get(pathway_id) or pathway_id,
            "database": database,
            "input_count": foreground_count,
            "background_count": background_count,
            "input_total": len(foreground),
            "background_total": len(background),
            "fold_enrichment": round_or_none(fold, 3),
            "p_value": p_value,
            "contributing_protein_ids": sorted(proteins & foreground),
        })
    q_values = bh_adjust([row["p_value"] for row in tested])
    for row, q_value in zip(tested, q_values):
        row["q_value"] = round_or_none(q_value, 6)
        row["p_value"] = round_or_none(row["p_value"], 6)
        row["significant"] = q_value <= 0.05
    tested.sort(key=lambda row: (row["q_value"], row["p_value"], row["pathway_id"]))
    return {
        "database": database,
        "foreground_total": len(foreground),
        "background_total": len(background),
        "tested_pathway_count": len(tested),
        "significant_pathway_count": sum(1 for row in tested if row["significant"]),
        "pathways": tested,
    }


def analyze(
    dataset: dict,
    source_bytes: bytes,
    *,
    dataset_path: Path | None = None,
    args: argparse.Namespace | None = None,
    parameters: dict | None = None,
) -> dict:
    args = args or argparse.Namespace(refresh=False, no_network=False)
    table_issues: list[dict] = []
    host_rows = table_rows(dataset, "host_proteins", table_issues)
    interaction_rows = table_rows(dataset, "interactions", table_issues)

    hosts = {
        row.get("entity_id"): row
        for row in host_rows
        if isinstance(row, dict) and row.get("entity_id")
    }
    foreground_ids = {
        row.get("host_protein_id")
        for row in interaction_rows
        if isinstance(row, dict) and row.get("host_protein_id") in hosts
    }

    validation_issues = list(table_issues)
    warnings: list[str] = []
    proteins_by_db: dict[str, dict[str, set[str]]] = {
        "Reactome": defaultdict(set),
        "KEGG": defaultdict(set),
    }
    names_by_db: dict[str, dict[str, str]] = {"Reactome": {}, "KEGG": {}}
    annotated_by_db: dict[str, set[str]] = {"Reactome": set(), "KEGG": set()}

    kegg_gene_ids = set()
    kegg_resolved_genes = set()
    kegg_unresolved_genes: list[dict] = []
    for entity_id, row in hosts.items():
        for pathway in pathway_rows(row):
            if pathway["database"] == "Reactome":
                proteins_by_db["Reactome"][pathway["id"]].add(entity_id)
                names_by_db["Reactome"].setdefault(pathway["id"], pathway["name"])
                annotated_by_db["Reactome"].add(entity_id)
            elif pathway["database"] == "KEGG":
                kegg_gene_ids.add(pathway["id"])

    kegg_names: dict[str, str] = {}
    if kegg_gene_ids:
        try:
            kegg_names = fetch_kegg_pathway_names(CACHE_ROOT, args)
        except ApiError as exc:
            warnings.append(f"KEGG pathway names unavailable: {exc}")
        gene_to_proteins: dict[str, set[str]] = defaultdict(set)
        for entity_id, row in hosts.items():
            for pathway in pathway_rows(row):
                if pathway["database"] == "KEGG":
                    gene_to_proteins[pathway["id"]].add(entity_id)
        for gene_id, proteins in sorted(gene_to_proteins.items()):
            if not gene_id.startswith(PARAMETERS["kegg_species_prefix"]):
                reason = (
                    f"unsupported KEGG species prefix; expected "
                    f"{PARAMETERS['kegg_species_prefix']}"
                )
                kegg_unresolved_genes.append({"gene_id": gene_id, "reason": reason})
                warnings.append(f"Excluded non-human KEGG gene ID {gene_id}.")
                continue
            try:
                links = fetch_kegg_gene_pathways(gene_id, CACHE_ROOT, args)
            except ApiError as exc:
                warnings.append(f"KEGG mapping unavailable for {gene_id}: {exc}")
                kegg_unresolved_genes.append({"gene_id": gene_id, "reason": str(exc)})
                continue
            if not links:
                kegg_unresolved_genes.append({"gene_id": gene_id, "reason": "no pathway links returned"})
                continue
            kegg_resolved_genes.add(gene_id)
            for link in links:
                pathway_id = link["pathway_id"]
                proteins_by_db["KEGG"][pathway_id].update(proteins)
                names_by_db["KEGG"].setdefault(pathway_id, kegg_names.get(pathway_id, pathway_id))
                annotated_by_db["KEGG"].update(proteins)

    background_ids_by_db = {
        database: {
            entity_id for entity_id in annotated_by_db[database] if entity_id in hosts
        }
        for database in proteins_by_db
    }

    enrichment: dict[str, dict] = {}
    for database in ("Reactome", "KEGG"):
        enrichment[database] = enrich_database(
            database=database,
            proteins_by_pathway=proteins_by_db[database],
            names=names_by_db[database],
            foreground_ids=foreground_ids,
            background_ids=background_ids_by_db[database],
        )

    pathways = []
    for database in ("Reactome", "KEGG"):
        for pathway_id, proteins in proteins_by_db[database].items():
            pathways.append({
                "database": database,
                "pathway_id": pathway_id,
                "pathway_name": names_by_db[database].get(pathway_id) or pathway_id,
                "protein_ids": sorted(proteins),
                "protein_count": len(proteins),
                "targeted_protein_ids": sorted(proteins & foreground_ids),
                "targeted_protein_count": len(proteins & foreground_ids),
            })
    pathways.sort(key=lambda row: (row["database"], -row["targeted_protein_count"], row["pathway_id"]))

    background_all = set().union(*background_ids_by_db.values()) if background_ids_by_db else set()
    mapped_foreground = foreground_ids & background_all
    reasons: list[str] = []
    low_power: list[str] = []
    if not foreground_ids:
        reasons.append("No host proteins are targeted by retained interactions.")
    elif len(foreground_ids) < PARAMETERS["minimum_foreground_size"]:
        reasons.append(f"Foreground has {len(foreground_ids)} proteins; at least {PARAMETERS['minimum_foreground_size']} are required.")
    if not pathways:
        reasons.append("No Reactome or KEGG pathway memberships could be mapped.")
    if any(item["database"] == "KEGG" and kegg_unresolved_genes for item in enrichment.values()):
        warnings.append(f"KEGG mapping incomplete for {len(kegg_unresolved_genes)} gene ID(s).")
    if not reasons:
        if len(foreground_ids) < PARAMETERS["low_power_foreground_size"]:
            low_power.append(f"Foreground has only {len(foreground_ids)} targeted proteins.")
        if len(background_all) < PARAMETERS["low_power_background_size"]:
            low_power.append(f"Background has only {len(background_all)} annotated proteins.")

    result = {
        "schema_version": OUTPUT_SCHEMA_VERSION,
        "status": status_from_reasons(reasons, low_power=low_power),
        "status_reasons": reasons,
        "warnings": warnings,
        "meta": provenance_meta(
            analysis="pathway_analysis",
            analysis_version=ANALYSIS_VERSION,
            dataset=dataset,
            source_bytes=source_bytes,
            dataset_path=dataset_path,
            input_tables=INPUT_TABLES,
            parameters={**PARAMETERS, **(parameters or {})},
        ),
        "statistics": {
            "foreground_protein_count": len(foreground_ids),
            "mapped_foreground_protein_count": len(mapped_foreground),
            "background_protein_count": len(background_all),
            "pathway_count": len(pathways),
            "reactome_pathway_count": sum(1 for row in pathways if row["database"] == "Reactome"),
            "kegg_pathway_count": sum(1 for row in pathways if row["database"] == "KEGG"),
            "reactome_tested_count": enrichment["Reactome"]["tested_pathway_count"],
            "reactome_significant_count": enrichment["Reactome"]["significant_pathway_count"],
            "kegg_tested_count": enrichment["KEGG"]["tested_pathway_count"],
            "kegg_significant_count": enrichment["KEGG"]["significant_pathway_count"],
            "kegg_gene_id_count": len(kegg_gene_ids),
            "kegg_resolved_gene_count": len(kegg_resolved_genes),
            "kegg_unresolved_gene_count": len(kegg_unresolved_genes),
        },
        "foreground_protein_ids": sorted(foreground_ids),
        "background_protein_ids": sorted(background_all),
        "pathways": pathways,
        "enrichment": enrichment,
        "kegg_mapping": {
            "gene_id_count": len(kegg_gene_ids),
            "resolved_gene_ids": sorted(kegg_resolved_genes),
            "unresolved_genes": kegg_unresolved_genes,
        },
        "validation": {
            "issues": sorted(validation_issues, key=issue_sort_key),
            "issue_counts": count_issue_codes(validation_issues),
        },
    }
    return result


def validate_result(result: dict) -> list[dict]:
    issues: list[dict] = []
    seen = set()
    for pathway in result.get("pathways", []):
        key = (pathway["database"], pathway["pathway_id"])
        if key in seen:
            issues.append(issue("duplicate_pathway", "Duplicate pathway row.", f"{key[0]}:{key[1]}"))
        seen.add(key)
        if pathway["targeted_protein_count"] > pathway["protein_count"]:
            issues.append(issue("targeted_count", "Targeted proteins exceed pathway proteins.", f"{key[0]}:{key[1]}"))
    for database, payload in result.get("enrichment", {}).items():
        for row in payload.get("pathways", []):
            if not (0.0 <= row["p_value"] <= 1.0) or not (0.0 <= row["q_value"] <= 1.0):
                issues.append(issue("p_value_range", "p/q value outside [0, 1].", row.get("pathway_id")))
    return issues


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DATASET_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--check", action="store_true", help="calculate without writing the artifact")
    parser.add_argument("--strict", action="store_true", help="exit non-zero on validation issues")
    parser.add_argument("--refresh", action="store_true", help="ignore cached KEGG responses")
    parser.add_argument("--no-network", action="store_true", help="use only cached KEGG responses")
    args = parser.parse_args(argv)

    try:
        dataset, source_bytes = read_dataset(args.dataset)
    except (OSError, ValueError) as exc:
        print(f"error: cannot read dataset: {exc}", file=sys.stderr)
        return 2

    result = analyze(dataset, source_bytes, dataset_path=args.dataset, args=args)
    result_issues = validate_result(result)
    result["validation"]["issues"].extend(result_issues)
    result["validation"]["issues"].sort(key=issue_sort_key)
    result["validation"]["issue_counts"] = count_issue_codes(result["validation"]["issues"])
    if not args.check:
        write_json_atomic(args.output, result)

    stats = result["statistics"]
    print(f"status: {result['status']}")
    print(f"pathways: {stats['pathway_count']} (Reactome {stats['reactome_pathway_count']}, KEGG {stats['kegg_pathway_count']})")
    print(f"KEGG genes mapped: {stats['kegg_resolved_gene_count']}/{stats['kegg_gene_id_count']}")
    print(f"significant: Reactome {stats['reactome_significant_count']}, KEGG {stats['kegg_significant_count']}")
    issues = result["validation"]["issues"]
    if issues:
        print(f"validation: {len(issues)} issue(s)", file=sys.stderr)
        for item in issues[:10]:
            row = f" [{item['row_id']}]" if item.get("row_id") else ""
            print(f"  {item['code']}{row}: {item['detail']}", file=sys.stderr)
    else:
        print("validation: ok")
    return 1 if args.strict and issues else 0


if __name__ == "__main__":
    raise SystemExit(main())

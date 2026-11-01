# PathoMap dataset

Schema version **2.0**. The current release contains one table: `pathogens`.

The v1 flat export (all six tables plus derived analyses) is preserved in
`data/archive/v1/` and is not loaded by the application. Tables will be
rebuilt one at a time, starting with the root table.

## Files

| Path | Kind | Purpose |
|---|---|---|
| `data/sources/curated_data.json` | Source | Curated base rows migrated from v1 (identity, Gram reaction, strategy, DOI, description). |
| `data/sources/pathogen_overrides.json` | Source | Manual overrides for NCBI lookups. Keys are `pathogen_id` values; any provided field wins. |
| `data/sources/ncbi/` | Cache | Raw NCBI Taxonomy and Datasets responses used for provenance. Safe to delete and refetch. |
| `data/pathomap-dataset.json` | Generated | The JSON the web app loads. `{ meta, pathogens }`. |
| `data/sample-dataset.json` | Generated | Five-pathogen sample used by **Load Built-in Sample**. |
| `data/pathomap.db` | Generated | SQLite database with the same table, constraints, and indexes. |
| `data/schema.sql` | Generated | SQLite DDL for the pathogens table. |
| `data/schema/pathogens.schema.json` | Generated | JSON Schema for the dataset envelope and rows. |
| `scripts/build_pathogens.py` | Build | Enrichment, validation, and export pipeline. |

## Pathogens schema

| Field | Type | Allowed values / notes | Source |
|---|---|---|---|
| `pathogen_id` | integer | Stable internal ID, unchanged from v1. | Curation |
| `name` | string | Display name, including serovar/strain where relevant. | Curation |
| `genus` | string | Taxonomic genus. | NCBI Taxonomy |
| `species` | string | Binomial species name. | NCBI Taxonomy / curation |
| `serovar` | string or null | Serovar or pathotype when below species level. | Curation |
| `strain` | string or null | Strain designation (e.g., "K1" for E. coli K1). | Curation |
| `tax_id` | integer | NCBI Taxonomy identifier. | NCBI Taxonomy |
| `ncbi_scientific_name` | string | Current NCBI scientific name for this tax_id. | NCBI Taxonomy |
| `family` | string | Taxonomic family. | NCBI Taxonomy |
| `order_name` | string | Taxonomic order (`order` is a SQL keyword). | NCBI Taxonomy |
| `class_name` | string | Taxonomic class (`class` is a SQL keyword). | NCBI Taxonomy |
| `phylum` | string | Taxonomic phylum. | NCBI Taxonomy |
| `gram_stain` | enum | `Gram-positive`, `Gram-negative`, `Gram-variable`, `unknown`. | Curation |
| `acid_fast` | boolean | Acid-fast staining property. The five Mycobacterium rows are `true`. | Curation |
| `strategy` | enum | `arrest`, `escape`, `reroute`, `modified_compartment`, `extracellular`, `unknown` (upload fallback only). | Curation |
| `strategy_secondary` | string or null | Secondary strategy if applicable. | Curation |
| `strategy_evidence` | string or null | Evidence citation for strategy classification. | Curation |
| `intracellular_niche` | string or null | Description of intracellular compartment (e.g., "SCV", "cytosol"). | Curation |
| `genome_accession` | string or null | Representative NCBI assembly accession. | NCBI Datasets |
| `assembly_level` | enum | `Complete Genome`, `Chromosome`, `Scaffold`, `Contig`, `unknown`. | NCBI Datasets |
| `genome_size_mb` | number or null | Total assembly length in megabases. | NCBI Datasets |
| `gc_content` | number or null | GC content, percent. | NCBI Datasets |
| `n_contigs` | integer or null | Number of contigs. | NCBI Datasets |
| `reference_doi` | string | Primary curation DOI (starts with `10.`). | Curation |
| `description` | string | Curated prose summary migrated unchanged from v1. | Curation |
| `curation_notes` | string or null | Free-form curation notes or caveats. | Curation |
| `curation_status` | enum | `curated` or `needs_review`. | Curation |
| `last_updated` | date | ISO date of the last build. | Build |

`n_effectors` was removed: it is derived from the effectors table and would go stale. It will be computed when that table returns.

## Enrichment rules

1. Each seed row gets an NCBI Taxonomy `tax_id` (a `tax_name` can be supplied for renamed organisms; a `tax_id` override also works).
2. Lineage fields come from the NCBI Taxonomy XML record.
3. The representative genome comes from NCBI Datasets. Complete assemblies are preferred, then chromosome, scaffold, and contig. RefSeq (`GCF_`) is preferred over GenBank (`GCA_`) at the same level.
4. `genome_size_mb` is `total_sequence_length / 1,000,000`, rounded to two decimals; GC is rounded to one decimal.
5. Anything that cannot be resolved is emitted with `curation_status: needs_review` rather than guessed.

Known naming note: several display names retain familiar v1 names even where NCBI now uses a different current name (for example `Borrelia burgdorferi` → `Borreliella burgdorferi`, `Streptomyces scabies` → `Streptomyces scabiei`, `Rhodococcus equi` → `Rhodococcus (subgen. Prescottella) equi`). The `tax_id` is authoritative; the seed stores the lookup name in `tax_name`. `Clostridium difficile` and `Salmonella typhi` were updated in the display name/seed to reflect their current taxonomic placement.

Assembly note: `Escherichia coli K1` has only scaffold-level RefSeq assemblies, so it is recorded as a `Scaffold`. All other rows currently resolve to complete genomes.

## Build and validate

```powershell
python scripts/build_pathogens.py            # build using cache when available
python scripts/build_pathogens.py --refresh  # ignore cached NCBI responses
python scripts/build_pathogens.py --check    # validate only, write nothing
python scripts/build_pathogens.py --no-network
```

The build fails if validation fails. It checks unique IDs, names, and tax IDs; required fields; enum values; DOI format; ISO dates; and numeric ranges (genome 0.1–20 Mb, GC 10–90%, contigs ≥1).

## Adding the next table

1. Add its source file under `data/sources/`.
2. Extend the build script (or add a sibling script) to emit it into the same dataset envelope.
3. Add its schema/config to `js/data/schema.js` and a tab entry in `js/views/database.js`.
4. Add its SQLite DDL and validation rules.

Keep joins keyed by stable IDs, never by display names.

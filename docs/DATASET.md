# PathoMap dataset

Schema version **2.0**. The current release contains three tables: `pathogens` (53),
`effectors` (246) and `host_proteins` (20). References and generated analyses are not yet part of
the dataset.

This is the authoritative reference for table structure. The v1 flat export is not present in
this repository; tables are rebuilt from `data/sources/` one stage at a time.

## Files

| Path | Kind | Purpose |
|---|---|---|
| `data/sources/pathogens_seed.json` | Source | Curated base pathogen rows. |
| `data/sources/effectors_seed.json` | Source | Curated effector rows linked to pathogens. |
| `data/sources/host_proteins_seed.json` | Source | Curated host protein rows. |
| `data/sources/effector_uniprot_mapping.json` | Source | Effector name -> UniProt accession. |
| `data/sources/pathogen_overrides.json` | Source | Manual overrides for NCBI lookups. |
| `data/sources/ncbi/` | Cache | NCBI Taxonomy and Datasets responses. |
| `data/sources/uniprot/`, `interpro/`, `pfam/`, `string/` | Cache | Protein enrichment responses. |
| `data/pathomap-dataset.json` | Generated | The JSON the web app loads. `{ meta, pathogens, effectors, host_proteins }`. |
| `data/sample-dataset.json` | Generated | Five-pathogen sample used by **Load Built-in Sample**. |
| `data/pathomap.db` | Generated | SQLite database with the same tables. |
| `data/schema.sql` | Generated | SQLite DDL. |
| `data/schema/pathogens.schema.json` | Generated | JSON Schema for the dataset envelope and pathogen rows. |

## Table relationships

```
pathogens (pathogen_id)
    └──< effectors (pathogen_name -> pathogens.name)
             └──< host_target (name/class, not a foreign key yet)

host_proteins (host_protein_id)
    └── interacting_partners (STRING ids, not a foreign key)
```

- `pathogens` is the parent table. `pathogen_id` is the only stable ID currently used for joins.
- `effectors` currently join to pathogens by `pathogen_name`, not `pathogen_id`. This is a known
  weakness; a stable `effector_id` and a `pathogen_id` foreign key are planned (see
  `docs/ROADMAP.md` Phase 1).
- `effectors.host_target` and `host_proteins.protein_name` are not yet linked by a foreign key.
- `host_proteins.interacting_partners` stores STRING protein IDs, which cannot be joined back to
  `host_proteins` without a separate mapping.
- No references table exists; citations are stored per row (`reference_doi`).

## Schema version history

| Version | Date | Changes |
|---|---|---|
| 2.0 | 2026-11 | Three-table release (`pathogens`, `effectors`, `host_proteins`); NCBI and protein enrichment; computed sequence features; `n_effectors` removed because it was derivable and went stale. |
| 1.0 | — | Flat v1 export with six tables and derived analyses. Not present in this repository. |

`SCHEMA_VERSION` is defined in `scripts/build_pathogens.py`, `scripts/build_effectors_host_proteins.py`
and `js/data/schema.js`; all three must agree.

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
| `acid_fast` | boolean | Acid-fast staining property. | Curation |
| `strategy` | enum | `arrest`, `escape`, `reroute`, `modified_compartment`, `extracellular`, `unknown`. | Curation |
| `strategy_secondary` | string or null | Secondary strategy if applicable. | Curation |
| `strategy_evidence` | string or null | Evidence citation for strategy classification. | Curation |
| `intracellular_niche` | string or null | Intracellular compartment description. | Curation |
| `genome_accession` | string or null | Representative NCBI assembly accession. | NCBI Datasets |
| `assembly_level` | enum | `Complete Genome`, `Chromosome`, `Scaffold`, `Contig`, `unknown`. | NCBI Datasets |
| `genome_size_mb` | number or null | Assembly length in megabases. | NCBI Datasets |
| `gc_content` | number or null | GC content, percent. | NCBI Datasets |
| `n_contigs` | integer or null | Number of contigs. | NCBI Datasets |
| `reference_doi` | string | Primary curation DOI. | Curation |
| `description` | string | Curated prose summary. | Curation |
| `curation_notes` | string or null | Free-form curation notes or caveats. | Curation |
| `curation_status` | enum | `curated` or `needs_review`. | Curation |
| `last_updated` | date | ISO date of the last build. | Build |

`n_effectors` was removed: it is derived from the effectors table and would go stale.

## Effectors schema

Key `(effector_name, pathogen_name)`. A stable `effector_id` is planned (see `docs/ROADMAP.md`).

| Field | Type | Notes |
|---|---|---|
| `effector_name` | string | Effector display name. |
| `effector_name_class` | string or null | Protein-family classification. |
| `pathogen_name` | string | Producing pathogen (display name; will move to `pathogen_id`). |
| `host_target` | string | Host protein or cellular component targeted. |
| `host_target_class` | string or null | Target classification (protein, organelle, pathway, ...). |
| `type`, `type_class` | string | Secretion type (T3SS/T4SS/T6SS, toxin, ...) and its classification. |
| `mechanism`, `mechanism_class` | string | Host-cell manipulation mechanism and its classification. |
| `uniprot_id` | string or null | UniProt accession (curated or search fallback). |
| `sequence` | string or null | Amino-acid sequence. |
| `sequence_length` | integer or null | Length in residues. |
| `molecular_weight_da` | number or null | Calculated molecular weight. |
| `isoelectric_point` | number or null | Calculated pI. |
| `gravy_score` | number or null | Calculated GRAVY. |
| `domains` | array | UniProt/InterPro/Pfam domain annotations. |
| `go_terms` | array | UniProt GO annotations. |
| `signal_peptide` | object or null | `{start, end}` annotation. |
| `transmembrane_regions` | array | `[{start, end}, ...]` annotations. |

Sequence-derived values are currently stored on the curated rows. The target state moves them to a
derived table keyed by `effector_id`, with method and input-version provenance.

## Host proteins schema

| Field | Type | Notes |
|---|---|---|
| `host_protein_id` | integer | Stable internal ID. |
| `protein_name`, `gene_name` | string | Display name and gene symbol. |
| `uniprot_id` | string | Unique UniProt accession. |
| `sequence`, `sequence_length` | string / integer | Sequence and length. |
| `molecular_weight_da`, `isoelectric_point`, `gravy_score` | number | Calculated properties. |
| `domains`, `go_terms` | array | UniProt/InterPro/Pfam and GO annotations. |
| `localization` | string | Curated localization. |
| `function` | string | Curated functional summary. |
| `pathway`, `pathways_detailed` | string / array | Pathway membership (KEGG/Reactome). |
| `interacting_partners` | array | STRING partners with scores. |
| `reference_doi` | string or null | Curation reference. |
| `last_updated` | date | ISO date of the last build. |

## Generated analyses (target state)

Analyses are not part of the curated dataset. When added they must live in a separate derived
layer (`data/derived/` or an equivalent cache) and carry:

- Stable generated-record ID and source record IDs.
- Module and software version.
- Input dataset version or content hash.
- Algorithm, parameters and reference-resource versions.
- Evidence class (`experimental`, `predicted`, `annotation-derived`, `hypothetical`).
- Confidence/score definition, citation/accession, timestamp and validation status.

Module definitions and evidence rules: `docs/ANALYSES.md`.

## Enrichment rules

1. Each pathogen seed row gets an NCBI Taxonomy `tax_id`.
2. Lineage fields come from the NCBI Taxonomy XML record.
3. The representative genome comes from NCBI Datasets, preferring complete assemblies, then
   chromosome, scaffold and contig; RefSeq over GenBank at the same level.
4. `genome_size_mb` is `total_sequence_length / 1,000,000`, rounded to two decimals; GC to one.
5. Effectors and host proteins are enriched through UniProt; domains fall back to
   InterPro/Pfam; host partners come from STRING.
6. Anything that cannot be resolved is emitted with `curation_status: needs_review` or as a
   warning rather than guessed.

See `docs/DATA_PIPELINE.md` for the protein enrichment pipeline and field provenance.

### Field provenance

| Field group | Provenance |
|---|---|
| `pathogen_id`, names, `serovar`, `strain`, `gram_stain`, `acid_fast`, `strategy*`, `intracellular_niche`, `description`, `curation_notes`, `curation_status` | Curated |
| `tax_id`, `ncbi_scientific_name`, lineage fields | NCBI Taxonomy |
| `genome_accession`, `assembly_level`, `genome_size_mb`, `gc_content`, `n_contigs` | NCBI Datasets |
| `sequence`, `uniprot_id`, `go_terms`, `pathways_detailed`, `signal_peptide`, `transmembrane_regions` | UniProt |
| `molecular_weight_da`, `isoelectric_point`, `gravy_score`, `sequence_length` | Calculated from sequence |
| `domains` | UniProt features, then InterPro, then Pfam |
| `interacting_partners` | STRING |
| `last_updated`, `meta.built_at` | Build timestamp |

## Build and validate

```powershell
python scripts/build_pathogens.py                 # build pathogens using cache
python scripts/build_pathogens.py --check         # validate only
python scripts/build_pathogens.py --refresh       # ignore cached NCBI responses
python scripts/build_pathogens.py --no-network

python scripts/build_effectors_host_proteins.py --enrich-effectors
python scripts/build_effectors_host_proteins.py --check
```

The pathogens build fails if validation fails. It checks unique IDs, names and tax IDs; required
fields; enum values; DOI format; ISO dates; and numeric ranges. The protein build validates
sequence alphabets, numeric feature types and list types; enrichment failures are logged as
warnings rather than aborting.

## Adding the next table

1. Add its source file under `data/sources/`.
2. Extend the build script (or add a sibling script) to emit it into the same envelope.
3. Add its schema/config to `js/data/schema.js` and a tab entry in `js/views/database.js`.
4. Add its SQLite DDL, validation rules and JSON Schema.
5. Update this document.

Keep joins keyed by stable IDs, never by display names.

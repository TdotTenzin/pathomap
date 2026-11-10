# PathoMap dataset

Schema version **2.1**. The current release contains three tables: `pathogens` (53),
`effectors` (246) and `host_proteins` (20). Every row carries a stable, prefixed `entity_id`
(`PM-PAT-…`, `PM-EFF-…`, `PM-HST-…`). References and generated analyses are not yet part of the
dataset.

This is the authoritative reference for table structure. The v1 flat export is not present in
this repository; tables are rebuilt from `data/sources/` one stage at a time.

## Files

| Path | Kind | Purpose |
|---|---|---|
| `data/sources/pathogens_seed.json` | Source | Curated base pathogen rows. |
| `data/sources/effectors_seed.json` | Source | Curated effector rows linked to pathogens. |
| `data/sources/host_proteins_seed.json` | Source | Curated host protein rows. |
| `data/sources/effector_uniprot_mapping.json` | Source | Effector name -> UniProt accession. |
| `data/sources/effector_ids.json` | Source | Persistent effector entity-ID registry (assigned once, never reused). |
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
pathogens (entity_id, pathogen_id)
    └──< effectors (entity_id, pathogen_id FK)
             └──> host_proteins (entity_id, host_protein_id FK, nullable)

host_proteins (entity_id, host_protein_id)
    └── interacting_partners (STRING ids, not a foreign key)
```

- `entity_id` is the canonical cross-table identifier. `pathogen_id` and `host_protein_id` remain
  stable internal integer keys for SQLite joins and existing code.
- `effectors` reference their pathogen by `pathogen_id` (with `pathogen_name` retained for display).
- `effectors.host_protein_id` is populated only when `host_target` exactly matches a curated host
  protein's name, gene symbol, or UniProt accession. Unmatched targets remain free text and the
  foreign key is null; the build does not fuzzy-match biological names.
- `host_proteins.interacting_partners` stores STRING protein IDs, which cannot be joined back to
  `host_proteins` without a separate mapping.
- No references table exists; citations are stored per row (`reference_doi`).

## Entity identifiers

Canonical IDs use the form `PM-<TYPE>-<NNNN>`:

| Entity | Prefix | Example | Derived from |
|---|---|---|---|
| Pathogen | `PM-PAT` | `PM-PAT-0001` | Curated `pathogen_id` |
| Effector protein | `PM-EFF` | `PM-EFF-0001` | Registry keyed by `<pathogen_id>|<effector_name>` |
| Human host protein | `PM-HST` | `PM-HST-0001` | Curated `host_protein_id` |

Rules:

- One ID identifies one biological entity. IDs are unique within a table and unambiguous across
  tables because of the prefix.
- The ID format never encodes a display name, so no join depends on labels.
- Pathogen and host-protein IDs are deterministic from their curated integer keys and do not
  change when names are edited.
- Effector IDs are assigned once and recorded in `data/sources/effector_ids.json`, keyed by
  `<pathogen_id>|<effector_name>`. Existing assignments are never renumbered or reused, including
  after a row is temporarily removed. If an effector is deliberately renamed, update its registry
  key to keep the same ID.
- Future interaction and analysis records should store `entity_id` values (and may store the
  integer foreign keys for efficient joins), never display names.

The JSON envelope advertises the scheme in `meta.identifiers`, and `js/data/identifiers.js`
provides the matching frontend helpers.

## Schema version history

| Version | Date | Changes |
|---|---|---|
| 2.1 | 2026-11 | Stable `entity_id` on all three tables; effector `pathogen_id` foreign key; nullable effector `host_protein_id`; effector ID registry. |
| 2.0 | 2026-11 | Three-table release (`pathogens`, `effectors`, `host_proteins`); NCBI and protein enrichment; computed sequence features; `n_effectors` removed because it was derivable and went stale. |
| 1.0 | — | Flat v1 export with six tables and derived analyses. Not present in this repository. |

`SCHEMA_VERSION` is defined in `scripts/build_pathogens.py`, `scripts/build_effectors_host_proteins.py`
and `js/data/schema.js`; all three must agree.

## Pathogens schema

| Field | Type | Allowed values / notes | Source |
|---|---|---|---|
| `entity_id` | string | Canonical ID, `PM-PAT-<pathogen_id>`. | Identifier system |
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

Primary key `entity_id`. The natural uniqueness rule remains
`(effector_name, pathogen_name)`.

| Field | Type | Notes |
|---|---|---|
| `entity_id` | string | Canonical ID, `PM-EFF-<n>`. |
| `effector_name` | string | Effector display name. |
| `effector_name_class` | string or null | Protein-family classification. |
| `pathogen_id` | integer | Foreign key to `pathogens.pathogen_id`. |
| `pathogen_name` | string | Producing pathogen display name. |
| `host_protein_id` | integer or null | Foreign key to `host_proteins.host_protein_id` on exact target match; null otherwise. |
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
derived table keyed by `entity_id`, with method and input-version provenance.

## Host proteins schema

| Field | Type | Notes |
|---|---|---|
| `entity_id` | string | Canonical ID, `PM-HST-<host_protein_id>`. |
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

## Interaction evidence schema (Phase 3)

`interactions` is a normalized relationship table. Its stable primary key is
`interaction_id` (`PM-INT-<n>`); each row references an `effectors.entity_id`
(`PM-EFF-<n>`) and `host_proteins.entity_id` (`PM-HST-<n>`), and records the
mechanism, relationship predicate and provenance.

`interaction_evidence` is a separate one-to-many table. Its stable primary key
is `evidence_id` (`PM-EVD-<n>`) and it references `interaction_id`. Evidence
is classified as `experimental`, `predicted`, `annotation-derived` or
`hypothetical`; each record can retain DOI, PMID, database accession,
provenance and a note. This preserves multiple sources for one relationship
without duplicating that relationship.

The initial build creates annotation-derived records only where a curated
effector target has been audited as a single resolved human protein. It does
not infer interactions for ambiguous, family, complex or non-protein targets.
Add manual support to `data/sources/interaction_evidence_seed.json` and run
`python scripts/build_interactions.py`.

## Interaction analysis output (Phase 4)

Run `python scripts/analyze_interactions.py` to write
`data/derived/interaction_analysis.json`. This derived-only artifact records
the input dataset version/hash, validation and deterministic deduplication
results, interaction/evidence statistics, host proteins targeted by multiple
pathogens, and a structured network of pathogen, effector and host-protein
nodes with interaction edges. `--check` performs the same work without
replacing the output file.

## Generated analyses (target state)

Analyses are not part of the curated dataset. When added they must live in a separate derived
layer (`data/derived/` or an equivalent cache) and carry:

- Stable generated-record ID and source `entity_id` values (never display names).
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
python scripts/build_interactions.py --check
python scripts/analyze_interactions.py --check
```

The pathogens build fails if validation fails. It checks unique entity IDs, integer IDs, names
and tax IDs; required fields; enum values; DOI format; ISO dates; and numeric ranges. The protein
build additionally validates entity-ID format/uniqueness, effector `pathogen_id` and
`host_protein_id` referential integrity, sequence alphabets, numeric feature types and list
types. Enrichment failures are logged as warnings rather than aborting.

## Adding the next table

1. Add its source file under `data/sources/`.
2. Extend the build script (or add a sibling script) to emit it into the same envelope.
3. Add its schema/config to `js/data/schema.js` and a tab entry in `js/views/database.js`.
4. Add its SQLite DDL, validation rules and JSON Schema.
5. Add its entity prefix to `scripts/identifiers.py` and `js/data/identifiers.js`, with a
   deterministic or registered numbering rule.
6. Update this document.

Keep joins keyed by stable IDs, never by display names.

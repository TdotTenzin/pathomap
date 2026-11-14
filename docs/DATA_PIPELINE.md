# Data Pipeline

How manually curated seed files become the production datasets. Four stages run in order.

## Overview

```
data/sources/*.json (curation)
    -> build_pathogens.py (NCBI Taxonomy + Datasets)
    -> data/pathomap-dataset.json (pathogens only)
    -> build_effectors_host_proteins.py (UniProt/InterPro/Pfam/STRING)
    -> data/pathomap-dataset.json + data/sample-dataset.json
    -> data/pathomap.db + data/schema.sql
    -> build_interactions.py (relationships + row-level evidence)
    -> analyze_interactions.py (validation, statistics, network)
    -> data/derived/interaction_analysis.json
```

The build scripts share `scripts/http_client.py` for caching, per-host throttling and retries.
`scripts/api_clients.py` wraps the protein APIs and is used only by the protein stage.
`scripts/identifiers.py` is the shared source of truth for stable entity IDs.

## Stage 1: pathogens

`scripts/build_pathogens.py`

| Input | Source |
|---|---|
| `data/sources/pathogens_seed.json` | Curated base rows |
| `data/sources/pathogen_overrides.json` | Manual NCBI lookup overrides (pinned accessions, name fixes) |
| NCBI E-utilities | Taxonomy search and lineage |
| NCBI Datasets | Genome assembly metadata |

**Enrichment rules**

1. Resolve each seed row to an NCBI `tax_id`.
2. Fill lineage fields (`phylum`, `class_name`, `order_name`, `family`, `genus`, `species`) from the taxonomy record.
3. Choose a representative genome, preferring complete assemblies over chromosome/scaffold/contig and RefSeq over GenBank at the same level.
4. Convert length to `genome_size_mb` (two decimals) and GC to one decimal.
5. Assign `entity_id` as `PM-PAT-<pathogen_id>`.
6. Emit `pathomap-dataset.json`, `pathomap.db`, `schema.sql` and `data/schema/pathogens.schema.json`.

The build fails on validation errors (duplicate IDs/names/tax IDs, missing required fields,
invalid enums, bad DOIs, non-ISO dates, out-of-range numbers).

## Stage 2: proteins

`scripts/build_effectors_host_proteins.py`

| Input | Source |
|---|---|
| `data/sources/effectors_seed.json` | Curated effector rows |
| `data/sources/host_proteins_seed.json` | Curated host protein rows |
| `data/sources/effector_uniprot_mapping.json` | Effector name → UniProt accession |
| `data/sources/effector_ids.json` | Persistent effector entity-ID registry |
| UniProt | Sequences, domains, GO terms, pathways, signal peptide, transmembrane regions |
| InterPro / Pfam | Domain fallback with coordinates |
| STRING | Host-protein interaction partners (`required_score=700`) |

**Identifier and link assignment** runs before enrichment:

1. Host proteins get `PM-HST-<host_protein_id>`.
2. Effectors get `pathogen_id` from the pathogens table and their `PM-EFF-…` ID from the registry.
3. `host_protein_id` is set only on an exact (case-insensitive) match between `host_target` and a
   host protein name, gene symbol, or UniProt accession.
4. New effector registry keys are appended deterministically and written back to
   `data/sources/effector_ids.json`.

**Host proteins** are always enriched (they carry `uniprot_id`). **Effectors** are enriched only
with `--enrich-effectors`, because resolving them is slower and less reliable.

Effector resolution order:

1. `"Effector|Pathogen name"` key in the mapping file, then bare `"Effector"` key.
2. UniProt search by effector name + pathogen name, keeping only organism-matching hits.
3. Otherwise keep the curated seed row and log a warning.

**Domain priority:** UniProt `Domain`/`Region` features with coordinates → InterPro API → Pfam
API → UniProt cross-references without coordinates.

**Computed fields:** `molecular_weight_da` (residue mass sum minus water), `isoelectric_point`
(Henderson–Hasselbalch charge solved by bisection) and `gravy_score` (Kyte–Doolittle mean) are
calculated from the sequence, not fetched. `signal_peptide` and `transmembrane_regions` are
UniProt annotations, not predictions.

**Outputs:** updated `pathomap-dataset.json`, `sample-dataset.json`, `pathomap.db`, `schema.sql`.
The sample keeps 5 pathogens, 27 effectors and all 33 host proteins.

## Stage 3: interaction evidence

`scripts/build_interactions.py`

| Input | Source |
|---|---|
| Dataset effectors and host targets | Stage 2 output |
| `data/sources/interaction_evidence_seed.json` | Optional curator-supplied evidence |
| `data/sources/interaction_ids.json`, `interaction_evidence_ids.json` | Persistent ID registries |

Creates one `interactions` row per resolved effector → host-protein pair and a separate
`interaction_evidence` row describing its derivation. The initial build emits
`annotation-derived` evidence only where a curated target audited as a single human protein.
Manual evidence may add DOI, PMID, accession, provenance and a note without duplicating the
relationship. Ambiguous, family, complex and non-protein targets are intentionally excluded.

**Outputs:** updated `pathomap-dataset.json`, `sample-dataset.json`, `pathomap.db`,
`schema.sql`, interaction and evidence registries.

## Stage 4: interaction analysis

`scripts/analyze_interactions.py`

A read-only analysis engine over the validated interaction tables. It checks stable-ID
format/resolution, deduplicates relationships (retaining the earliest stable interaction ID)
and evidence (by interaction, class, identifiers and provenance), and records every discarded
row with a code and message. It computes unique effectors, host proteins, curated host targets
and pathogens; multi-pathogen host proteins; evidence counts/coverage by class and citation;
unresolved targets by resolution status; and a bipartite network of pathogen, effector and
host-protein nodes with evidence-bearing edges.

**Outputs:** `data/derived/interaction_analysis.json`, including source schema/build timestamp,
input SHA-256 and analysis parameters. Curated tables are never modified.
`--check` validates without writing, `--dataset`/`--output` override paths, and `--strict`
returns a non-zero exit code when any validation or result issue exists.

## Caching

All responses are cached under `data/sources/`:

- `uniprot/entries/{accession}.json` — full UniProt entries
- `uniprot/search/{query}.json` — effector name searches
- `interpro/matches/{accession}.json` — InterPro matches
- `pfam/matches/{accession}.json` — Pfam matches
- `string/ids/{accession}.json` — UniProt → STRING id resolution
- `string/interactions/{accession}.json` — STRING networks
- `ncbi/` — see `data/sources/ncbi/README.md`

The effector ID registry is **not** a cache: it is a curated source file that must be committed
with effector seed changes so IDs stay stable.

`api_clients.py` also defines an `uniprot/sequences/` cache path, but current builds do not
populate it. Caches are safe to delete; they are regenerable.

## Rate limits and retries

Per-host minimum spacing in `http_client.py`:

| Host | Spacing | Effective rate |
|---|---|---|
| `rest.uniprot.org` | 0.05 s | ~20 req/s (conservative) |
| `www.ebi.ac.uk` (InterPro/Pfam) | 0.10 s | ~10 req/s |
| `string-db.org` | 1.00 s | 1 req/s |
| NCBI hosts | 0.34 s | ~3 req/s |

Each request is attempted 3 times. On 429/502/503/504 the client honours `Retry-After` when
present; otherwise it waits `1.5 × (attempt + 1)` seconds. Enrichment failures are logged as
warnings and never abort the build.

## Usage

```powershell
# Stage 1 (cached) and stage 2 (host proteins only)
python scripts/build_pathogens.py
python scripts/build_effectors_host_proteins.py

# Also enrich effectors
python scripts/build_effectors_host_proteins.py --enrich-effectors

# Force fresh API calls
python scripts/build_pathogens.py --refresh
python scripts/build_effectors_host_proteins.py --enrich-effectors --refresh

# Offline (cached responses only)
python scripts/build_pathogens.py --no-network
python scripts/build_effectors_host_proteins.py --enrich-effectors --no-network

# Build and analyze interactions
python scripts/build_interactions.py
python scripts/analyze_interactions.py

# Validate without writing outputs
python scripts/build_pathogens.py --check
python scripts/build_effectors_host_proteins.py --check
python scripts/build_interactions.py --check
python scripts/analyze_interactions.py --check

# Fail CI on interaction-analysis validation warnings
python scripts/analyze_interactions.py --strict

# Run Python known-answer tests and the browser network-model test
python -m unittest discover -s tests -v
node --test tests/network_model.test.mjs
```

`--check` still builds and enriches in memory, then validates and skips file writes.

## Adding a new data source

1. Add a fetcher to `scripts/api_clients.py` (or `build_pathogens.py` for NCBI).
2. Give it a cache directory under `data/sources/`.
3. Integrate it into the relevant build stage.
4. Add validation for the new fields.
5. Add column metadata in `js/data/schema.js` and normalization in `js/utils/dataset.js`.
6. Document the field and its provenance here and in `docs/DATASET.md`.

## Field reference

- `domains`: `{"name", "accession", "start", "end"}`; coordinates are present for UniProt
  features and InterPro/Pfam API results, absent for plain cross-references.
- `go_terms`: `{"id", "term", "aspect"}` with aspect `F`/`P`/`C`.
- `pathways_detailed`: `{"database", "id", "name"}` (KEGG or Reactome).
- `interacting_partners`: `{"string_id", "name", "score"}`; STRING does not return UniProt
  accessions for partners.
- `signal_peptide`: `{"start", "end"}` or `null`.
- `transmembrane_regions`: `[{"start", "end"}, ...]`.

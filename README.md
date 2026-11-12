# PathoMap

A curated host–pathogen dataset and browser for studying bacterial pathogens, their effector
proteins, and the host proteins they target.

## Dataset

Schema version **2.1**, three tables. Every row carries a stable entity ID
(`PM-PAT-…`, `PM-EFF-…`, `PM-HST-…`) used for cross-table joins and future analyses:

| Table | Rows | Contents |
|---|---|---|
| `pathogens` | 53 | Stable ID, NCBI taxonomy, genome assembly metadata, Gram/acid-fast status, intracellular strategy |
| `effectors` | 246 | Stable ID, pathogen/host foreign keys, UniProt/InterPro/Pfam annotations and computed features |
| `host_proteins` | 20 | Stable ID, UniProt, GO, pathway and STRING partner data |

A 5-pathogen, 27-effector sample is bundled for demos. Generated analyses (interaction, pathway,
network, enrichment, sequence, comparative, host-response, predictive) are **planned, not
implemented**; see `docs/ANALYSES.md` and `docs/ROADMAP.md`.

## Quick start

Serve the directory over HTTP (the browser must be able to fetch JSON):

```powershell
python -m http.server 8000
```

Open <http://localhost:8000>.

## Build the dataset

Run the stages in order:

```powershell
python scripts/build_pathogens.py                        # NCBI enrichment
python scripts/build_effectors_host_proteins.py          # host proteins (UniProt/STRING)
python scripts/build_effectors_host_proteins.py --enrich-effectors  # also effectors
python scripts/build_interactions.py                     # relationships + evidence
python scripts/analyze_interactions.py                   # validated statistics + network
```

The final step writes `data/derived/interaction_analysis.json`. Add `--strict` to make
validation warnings fail (useful in CI).

Useful build flags:

| Flag | Effect |
|---|---|
| `--check` | Build and validate in memory; write nothing |
| `--refresh` | Ignore cached API responses |
| `--no-network` | Use only cached responses |

Requirements: Python 3, internet access for uncached API calls. No frontend build step or
dependencies. Full pipeline details: `docs/DATA_PIPELINE.md`.

## Project layout

```
host-pathogen-tracker/
├── index.html                  # SPA shell
├── css/                        # base, layout, components, utilities
├── js/                         # vanilla ES modules (data, ui, utils, views)
├── scripts/                    # Python build pipeline
├── data/
│   ├── pathomap-dataset.json   # generated; loaded by the app
│   ├── sample-dataset.json     # generated; built-in sample
│   ├── pathomap.db             # generated SQLite database
│   ├── schema.sql              # generated SQLite DDL
│   ├── classification-mapping.json
│   ├── schema/                 # generated JSON Schema
│   └── sources/                # curated seeds + API caches
└── docs/                       # documentation
```

Generated files should not be edited by hand. Source-of-truth files live in `data/sources/`.
Frontend modules, navigation and data flow are documented in `docs/ARCHITECTURE.md`.

## Documentation

| Document | Purpose |
|---|---|
| `docs/README.md` | Documentation index and ownership map |
| `docs/ARCHITECTURE.md` | System design, repository layout, frontend modules, navigation |
| `docs/DATASET.md` | Table schemas, relationships, provenance, schema history |
| `docs/DATA_PIPELINE.md` | Seed → dataset build, API enrichment, caching, rate limits |
| `docs/ANALYSES.md` | Planned analysis modules, evidence classes, provenance rules |
| `docs/ROADMAP.md` | Prioritised roadmap and implementation status |
| `docs/SEQUENCE_FEATURES.md` | Effector sequence-feature backlog and status |
| `data/README.md` | Data directory reference |
| `data/sources/README.md` | Seed files and API cache reference |
| `data/sources/ncbi/README.md` | NCBI cache reference |

## Contributing

When adding a pathogen:

1. Add it to `data/sources/pathogens_seed.json`.
2. Run `python scripts/build_pathogens.py --refresh`.
3. If the name does not match NCBI, add an override in `data/sources/pathogen_overrides.json`.
4. Add effectors to `data/sources/effectors_seed.json`.
5. Add known UniProt accessions to `data/sources/effector_uniprot_mapping.json`.
6. Run `python scripts/build_effectors_host_proteins.py --enrich-effectors`.

## Tech stack

- **Frontend:** vanilla JavaScript (ES modules), HTML5, CSS3
- **Backend:** none (static files)
- **Data:** JSON (primary), SQLite (generated)
- **Build:** Python 3
- **External APIs:** NCBI Taxonomy/Datasets, UniProt, InterPro/Pfam, STRING

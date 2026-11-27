# PathoMap

A curated host–pathogen dataset and browser for studying bacterial pathogens, their effector
proteins, and the host proteins they target.

## Dataset

Schema version **3.0**. Every row carries a stable entity ID (`PM-PAT-…`, `PM-EFF-…`,
`PM-HST-…`) used for cross-table joins and generated analyses:

| Table | Rows | Contents |
|---|---|---|
| `pathogens` | 53 | Stable ID, NCBI taxonomy, genome assembly metadata, Gram/acid-fast status, intracellular strategy |
| `effectors` | 246 | Stable ID, pathogen/host foreign keys, UniProt/InterPro/Pfam annotations |
| `host_proteins` | 33 | Stable ID, UniProt, GO, pathway and STRING partner data |
| `host_targets` | 129 | Audited effector target names and resolution status |
| `interactions` | 39 | Resolved effector–host protein relationships |
| `interaction_evidence` | 69 | Evidence class and provenance for each interaction |
| `references` | 58 | Citations used by curated records |

Database tabs cover pathogens, effectors, host targets, host proteins, interactions, references
and interaction evidence; uploaded datasets can populate every tab.

A 5-pathogen, 27-effector sample is bundled for demos. The Interaction Analysis page implements
an interactive, filterable pathogen → effector → host-protein network with evidence-aware edge
styling, node details and JSON/CSV/SVG exports. Other generated analyses are planned; see
`docs/ANALYSES.md`.

## Quick start

Serve the directory over HTTP (the browser must be able to fetch JSON):

```powershell
python -m http.server 8000
```

Open <http://localhost:8000/pages/index.html>. The interactive network is at
<http://localhost:8000/pages/interaction-analysis.html> after loading a dataset on the home page, or it
will fetch the curated dataset directly. Limitations and scope notes live at
<http://localhost:8000/pages/transparency.html> (also linked from each page's footer).

The home page is a single Discovery workspace with one upload/load area: paste or upload a CSV,
TSV, or JSON table, or click **Load example**, **Load curated dataset**, or **Load sample dataset**.
Any of those actions analyzes the data immediately; columns are auto-matched and can be corrected
before clicking **Discover insights** on pasted rows. Every module and the inline data table use
the same in-memory dataset. The workspace shows compact summary cards with a **Show full results**
link; following that link (or a module nav link) hands the active dataset to the module page once.
The module page consumes and clears the handoff, then runs its own detailed analysis. Module pages
do not duplicate the upload panel; load or change data in the Workspace and follow a module link.
Nothing is restored on page load, and localStorage is never used for datasets.

## Build the dataset

Run all four stages in dependency order with the orchestrator:

```powershell
python scripts/build_all.py                              # full build + build manifest
python scripts/build_all.py --enrich-effectors            # also enrich effector proteins
python scripts/build_all.py --check --no-network          # validate; write nothing; check freshness
```

The individual stages remain available for advanced use:

```powershell
python scripts/build_pathogens.py                        # NCBI enrichment
python scripts/build_effectors_host_proteins.py          # host proteins (UniProt/STRING)
python scripts/build_interactions.py                     # relationships + evidence
python scripts/analyze_interactions.py                   # validated statistics + network
```

A successful build records output hashes in `data/build-manifest.json`; `--check` compares
current artifacts against it and fails if a stage was skipped or an output changed.
Add `--strict` to make analysis validation warnings fail (useful in CI).

Useful build flags:

| Flag | Effect |
|---|---|
| `--check` | Build and validate in memory; write nothing |
| `--refresh` | Ignore cached API responses |
| `--no-network` | Use only cached responses |
| `--only <stage>` | Run one stage (`pathogens`, `effectors`, `interactions`, `analysis`) |

Verify the backend with `python -m unittest discover -s tests -v`.

Requirements: Python 3, internet access for uncached API calls. No frontend build step or
dependencies. Full pipeline details: `docs/DATA_PIPELINE.md`.

## Project layout

```
host-pathogen-tracker/
├── pages/
│   ├── index.html              # SPA shell
│   ├── interaction-analysis.html
│   └── transparency.html       # limitations and scope notes
├── css/                        # base, layout, components, utilities
├── js/                         # vanilla ES modules (data, discovery, experiment, ui, utils, views)
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

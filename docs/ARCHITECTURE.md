# Architecture

PathoMap has two independent concerns: a static browser application (presentation) and an
offline Python build pipeline (data production and derived analysis). The Interaction Analysis
artifact is produced in Python and consumed by the browser; no browser-side re-derivation occurs.

## System overview

```
data/sources/ (curated seeds + API caches)
    -> scripts/build_pathogens.py (NCBI enrichment)
    -> data/pathomap-dataset.json
    -> scripts/build_effectors_host_proteins.py (UniProt/InterPro/Pfam/STRING)
    -> data/pathomap-dataset.json + data/sample-dataset.json
    -> data/pathomap.db + data/schema.sql

pages/index.html -> js/main.js -> js/ui/discovery.js -> js/discovery/ingest.js
                 -> js/discovery/engine.js -> js/discovery/modules/*.js
                 -> js/data/loader.js -> js/views/database.js
                 -> js/ui/module-view.js (shared module cards)
pages/<module>.html -> js/pages/module-page.js -> js/ui/module-view.js
                 -> js/discovery/engine.js -> js/discovery/modules/*.js
pages/interaction-analysis.html -> js/pages/interaction-analysis.js
    -> js/data/loader.js + js/data/interaction-analysis.js
    -> js/analysis/network.js
    -> js/views/interaction-network.js
```

The web app never rewrites curated data. It loads a validated JSON envelope plus the generated
analysis artifact and renders them directly. Effector sequence descriptors missing from the
envelope are recomputed in memory from `sequence` during normalization, and unlabelled effectors
inherit a traceable `pathogens.strategy` phenotype; neither derived value is written back into the
curated dataset. The Discovery workspace computes explicit, labelled descriptors, network
structure, and descriptive statistics from user-pasted rows; those results are never written back
into the curated dataset either.

## Repository layout

```
host-pathogen-tracker/
├── pages/                      # workspace, eight module pages, transparency page
├── css/                        # base, layout, components, utilities
├── js/
│   ├── main.js                 # Boot: empty workspace, table, upload controls (no restore)
│   ├── data/
│   │   ├── loader.js           # Fetch + in-memory dataset
│   │   ├── interaction-analysis.js # Fetch derived interaction-analysis output
│   │   └── schema.js           # Columns, labels, enums, data dictionary
│   ├── discovery/
│   │   ├── engine.js           # Module orchestration and status aggregation
│   │   ├── ingest.js           # CSV/TSV/JSON parsing, column aliases, links
│   │   ├── modules/            # One module per docs/ANALYSES.md §1–§8
│   │   └── utils.js            # Small shared statistics helpers
│   ├── experiment/
│   │   ├── csv.js              # Delimited paste/upload parser
│   │   └── features.js         # Sequence descriptors mirroring the Python build
│   ├── ui/
│   │   ├── analyses.js         # Curated dataset analysis cards
│   │   ├── discovery.js        # Discovery workspace wiring
│   │   ├── module-view.js      # Shared module card/table/network renderer
│   │   ├── theme.js            # Dark-mode persistence
│   │   └── upload.js           # Legacy upload bar (superseded by discovery.js)
│   ├── utils/
│   │   ├── dataset.js          # Upload validation + normalization
│   │   └── export.js           # JSON/CSV/SVG download helpers
│   ├── views/
│   │   ├── database.js         # Tables, tabs, search, sort, pagination, CSV, schema panel
│   │   └── interaction-network.js # Layered SVG network, focus, details, SVG export
│   ├── analysis/
│   │   ├── eligibility.js      # Module prerequisite checks
│   │   ├── network.js          # Network model, filters, node/edge details
│   │   └── registry.js         # Analysis module registry
│   └── pages/
│       ├── module-page.js      # Standalone controller for one module
│       └── interaction-analysis.js # Interaction Analysis orchestration
├── scripts/
│   ├── build_pathogens.py      # NCBI enrichment, validation, JSON/SQLite exports
│   ├── build_effectors_host_proteins.py  # Protein enrichment, validation, exports
│   ├── api_clients.py          # UniProt/InterPro/Pfam/STRING clients
│   └── http_client.py          # Shared HTTP, caching, throttling, retries
├── data/
│   ├── pathomap-dataset.json   # Generated; loaded by the app
│   ├── sample-dataset.json     # Generated; built-in sample
│   ├── pathomap.db             # Generated SQLite database
│   ├── schema.sql              # Generated SQLite DDL
│   ├── classification-mapping.json  # Manually maintained classification map
│   ├── schema/                 # Generated JSON Schema
│   └── sources/                # Curated seeds, overrides and API caches
└── docs/                       # Documentation (see docs/README.md)
```

Directories marked `(planned)` do not exist yet. Do not create them until the corresponding
roadmap phase starts.

## Frontend

Vanilla ES modules, no build step, no external dependencies.

| Module | Purpose | Key exports |
|---|---|---|
| `js/main.js` | Boot and wiring (runs as an IIFE; no exports) | internal `boot()` |
| `js/data/loader.js` | Fetch dataset, hold in-memory state | `loadDataset()`, `setDataset()`, `getReferences()`, `getInteractionEvidence()` |
| `js/data/schema.js` | Column metadata, labels, enums | `COLUMN_META`, `EFFECTOR_COLUMNS_META`, `HOST_PROTEIN_COLUMNS_META`, `ENUMS` |
| `js/utils/dataset.js` | Validate and normalize uploads | `validateDataset()`, `normalizeDataset()` |
| `js/discovery/ingest.js` | Upload parsing and column mapping | `ingestText()`, `detectMapping()`, `summarizeUpload()` |
| `js/discovery/engine.js` | Module orchestration, validation, status counts | `runDiscovery()`, `DISCOVERY_MODULES` |
| `js/experiment/features.js` | Sequence descriptors | `calculateFeatures()`, `SEQUENCE_FEATURE_KEYS` |
| `js/ui/discovery.js` | Discovery workspace wiring | `initDiscovery()` |
| `js/ui/upload.js` | Legacy upload bar, no longer booted | `initUpload()` (unused) |
| `js/views/database.js` | Seven-tab database browser rendering | `initDatabase()`, `renderDatabase()` |
| `js/data/interaction-analysis.js` | Fetch optional Phase 4 analysis artifact | `loadInteractionAnalysis()` |
| `js/analysis/network.js` | Derived/dataset network model, filtering, detail joins | `buildNetworkModel()`, `filterNetwork()`, `buildNodeDetail()`, `buildEdgeDetail()` |
| `js/views/interaction-network.js` | Layered SVG network, selection, details, SVG export | `createNetworkView()` |
| `js/utils/export.js` | Download, CSV and XML helpers | `downloadText()`, `toCsv()`, `escapeXml()` |

**Data flow:** `pages/index.html` → `main.js` → empty workspace/table → explicit upload or dataset
load → `loader.js` + `database.js` + `discovery.js`. Pasted rows go through `ingest.js` →
`engine.js` → structured module results rendered into `#disc-results`.
Each `pages/<module>.html` page uses `module-page.js` → `engine.js` and renders only its own result
through `module-view.js`. Module pages have no upload panel; the dataset comes from a one-shot
handoff. Following a workspace link queues the active dataset in sessionStorage; the receiving page
consumes and clears it once. A direct visit with no handoff stays in the waiting state.
`pages/interaction-analysis.html` uses only that handed-off dataset, so example, sample, and
uploaded data drive the network. A direct visit with no handoff stays empty with a waiting message;
it never defaults to the curated dataset. The page then uses a generated artifact when its
provenance matches, otherwise it falls back to the normalized interaction tables.

**Separation of concerns:**

- Views render; scientific metrics live in `js/discovery/modules/` and `js/analysis/`.
- Analysis engines return structured data, never HTML.
- Shared utilities own identifier normalization, provenance, statistics and validation.
- Analysis state is independent of UI rendering.
- Use Web Workers for CPU-heavy modules; move to server-side compute only if justified.

## Information architecture

**Current state**

| Area | Status |
|---|---|
| Database tables | Tabs: `pathogens` (53), `effectors` (246), `host_targets` (129), `host_proteins` (33), `interactions` (39), `references` (58), `interaction_evidence` (69). |
| Navigation | Home, Database and Interaction Analysis |
| Generated analyses | Interaction Analysis network page implemented; seven other modules planned |
| Research & Methods page | Not implemented |

**Navigation:** one workspace plus a dedicated page for each of the eight analysis modules.
Transparency stays in the footer; every page shares the same module nav.

| Page | Purpose | Contents |
|---|---|---|
| Workspace | Load data and preview every module together | Upload/paste, dataset loaders, summary cards with module-page links, inline readiness assessment with filters and export, inline data table, export |
| Module pages | Run and inspect one module | `interaction-analysis.html`, `sequence-analysis.html`, `pathway-analysis.html`, `functional-enrichment.html`, `protein-network-analysis.html`, `comparative-pathogen-analysis.html`, `host-response-analysis.html` |
| Transparency | Interpretation and limitations | Footer-linked `pages/transparency.html` |

**Rules**

- Only link to pages that exist; every module nav link resolves to a real page.
- Module pages share `js/pages/module-page.js` and `js/ui/module-view.js`; the workspace uses the
  summary renderer from the same file, with links into the detailed pages. Module pages do not repeat
  the workspace `exp-panel`.
- The workspace has one upload/load area. Loading an example, file, curated, or sample dataset runs
  the analysis immediately; pasted rows run on **Discover insights**.
- Following a summary link or module nav link writes the active dataset to sessionStorage once.
  The module page consumes and clears that handoff on arrival, then runs only its own module.
  Page load never restores a dataset and localStorage is never used for datasets.
- Keep the data dictionary and dataset downloads inline in the workspace; they are not a separate
  page section.
- Keep references and interaction evidence as table tabs so uploads and exports share one path.
- Show honest module states: waiting, complete, insufficient data, failed.
- See `docs/ANALYSES.md` for module specs.

## Build pipeline

| Stage | Script | Inputs | Outputs |
|---|---|---|---|
| Pathogens | `build_pathogens.py` | `pathogens_seed.json`, `pathogen_overrides.json`, NCBI APIs | `pathomap-dataset.json`, `pathomap.db`, `schema.sql`, `schema/pathogens.schema.json` |
| Proteins | `build_effectors_host_proteins.py` | `effectors_seed.json`, `host_proteins_seed.json`, `effector_uniprot_mapping.json`, UniProt/InterPro/Pfam/STRING APIs | Updated `pathomap-dataset.json`, `sample-dataset.json`, `pathomap.db`, `schema.sql` |
| Interactions | `build_interactions.py` | Dataset effectors/host targets/host proteins, interaction seeds, ID registries | `interactions`, `interaction_evidence`, updated dataset/sample, SQLite tables, registries |
| Analysis | `analyze_interactions.py` | Validated dataset interactions/evidence | `data/derived/interaction_analysis.json` |
| Orchestration | `build_all.py` | All stages above | Full artifact set, `data/build-manifest.json`, automatic rollback on failure |

Run order matters: proteins expect the pathogens dataset, interactions expect resolved proteins,
and analysis expects the interaction table. Details are in `docs/DATA_PIPELINE.md`.

## Caching

- API caches live under `data/sources/` and are safe to delete; they are regenerable.
- `--refresh` ignores cached responses; `--no-network` uses only cached data and fails if a
  required cache file is missing.
- Caches exist for reproducibility and offline builds, not as curated data.
- Derived artifacts live under `data/derived/`; the manifest records input hashes and staleness.

## Conventions

- Curated sources live in `data/sources/`; generated artifacts live in `data/`.
- Join by stable IDs (`entity_id`; optional integer keys `pathogen_id`, `host_protein_id`), never
  display names.
- Keep derived or model outputs out of the curated dataset.
- Update `docs/DATASET.md` when the schema changes and `docs/ANALYSES.md` when module behaviour
  changes.
- One authoritative document per subject; see `docs/README.md`.

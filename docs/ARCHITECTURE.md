# Architecture

PathoMap has two independent concerns: a static browser application (presentation) and an
offline Python build pipeline (data production and derived analysis). The Interaction Analysis
engine is implemented in Python; browser-side analysis orchestration remains planned.

## System overview

```
data/sources/ (curated seeds + API caches)
    -> scripts/build_pathogens.py (NCBI enrichment)
    -> data/pathomap-dataset.json
    -> scripts/build_effectors_host_proteins.py (UniProt/InterPro/Pfam/STRING)
    -> data/pathomap-dataset.json + data/sample-dataset.json
    -> data/pathomap.db + data/schema.sql

index.html -> js/main.js -> js/data/loader.js -> js/views/database.js
interaction-analysis.html -> js/pages/interaction-analysis.js
    -> js/data/loader.js + js/data/analysis.js
    -> js/analysis/network.js
    -> js/views/interaction-network.js
```

The web app never computes curated data. It loads a validated JSON envelope and renders it.
Analysis engines (planned) return structured results that views display without re-deriving
scientific metrics.

## Repository layout

```
host-pathogen-tracker/
├── index.html                  # SPA shell: nav, hero, database section
├── css/                        # base, layout, components, utilities
├── js/
│   ├── main.js                 # Boot: init database view + upload, load dataset
│   ├── data/
│   │   ├── loader.js           # Fetch + in-memory dataset
│   │   ├── analysis.js         # Fetch derived interaction-analysis output
│   │   └── schema.js           # Columns, labels, enums, data dictionary
│   ├── ui/
│   │   ├── analyses.js         # Generated Analyses cards
│   │   ├── theme.js            # Dark-mode persistence
│   │   └── upload.js           # Upload, built-in, sample and template loading
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
| `js/data/loader.js` | Fetch dataset, hold in-memory state | `loadDataset()`, `setDataset()` |
| `js/data/schema.js` | Column metadata, labels, enums | `COLUMN_META`, `EFFECTOR_COLUMNS_META`, `HOST_PROTEIN_COLUMNS_META`, `ENUMS` |
| `js/utils/dataset.js` | Validate and normalize uploads | `validateDataset()`, `normalizeDataset()` |
| `js/ui/upload.js` | Upload/sample/template flow | `initUpload()` |
| `js/views/database.js` | Database browser rendering | `initDatabase()`, `renderDatabase()` |
| `js/data/analysis.js` | Fetch optional Phase 4 analysis artifact | `loadInteractionAnalysis()` |
| `js/analysis/network.js` | Derived/dataset network model, filtering, detail joins | `buildNetworkModel()`, `filterNetwork()`, `buildNodeDetail()`, `buildEdgeDetail()` |
| `js/views/interaction-network.js` | Layered SVG network, selection, details, SVG export | `createNetworkView()` |
| `js/utils/export.js` | Download, CSV and XML helpers | `downloadText()`, `toCsv()`, `escapeXml()` |

**Data flow:** `index.html` → `main.js` → `loader.js` (fetch JSON) → `database.js` (render) with
`upload.js` replacing the in-memory dataset after validation. `interaction-analysis.html` loads the
same dataset, optionally fetches `data/derived/interaction_analysis.json`, and falls back to the
normalized interaction tables when the derived artifact does not match.

**Separation of concerns:**

- Views render; they do not compute scientific metrics.
- Analysis engines return structured data, never HTML.
- Shared utilities own identifier normalization, provenance, statistics and validation.
- Analysis state is independent of UI rendering.
- Use Web Workers for CPU-heavy modules; move to server-side compute only if justified.

## Information architecture

**Current state**

| Area | Status |
|---|---|
| Database tables | `pathogens` (53), `effectors` (246), `host_proteins` (33), plus host targets, references, interactions and evidence |
| Navigation | Home, Database and Interaction Analysis |
| Generated analyses | Interaction Analysis network page implemented; seven other modules planned |
| Research & Methods page | Not implemented |

**Target navigation:** four top-level destinations. Do not create one top-level link per
analysis module.

| Section | Purpose | Contents |
|---|---|---|
| Home | Introduce PathoMap and route users | Overview, capabilities, dataset status, entry points |
| Database | Load and inspect primary records | Upload/load controls; Pathogens; Effectors; Host Proteins; data dictionary; export |
| Generated Analyses | Monitor computation and explore findings | Dashboard, eight module cards, module pages |
| Research & Methods | Explain the science and computation | Sources, schemas, algorithms, statistics, evidence rules, limitations |

**Rules**

- Only link to sections that exist; do not expose dead navigation links.
- Deep-link module pages from the dashboard, not the top navigation.
- Keep the data dictionary and dataset downloads inside Database.
- Generated Analyses appears only after a dataset loads and validates.
- Show honest module states: queued, running, complete, insufficient data, skipped, failed.
- See `docs/ANALYSES.md` for module specs.

## Build pipeline

| Stage | Script | Inputs | Outputs |
|---|---|---|---|
| Pathogens | `build_pathogens.py` | `pathogens_seed.json`, `pathogen_overrides.json`, NCBI APIs | `pathomap-dataset.json`, `pathomap.db`, `schema.sql`, `schema/pathogens.schema.json` |
| Proteins | `build_effectors_host_proteins.py` | `effectors_seed.json`, `host_proteins_seed.json`, `effector_uniprot_mapping.json`, UniProt/InterPro/Pfam/STRING APIs | Updated `pathomap-dataset.json`, `sample-dataset.json`, `pathomap.db`, `schema.sql` |
| Interactions | `build_interactions.py` | Dataset effectors/host targets/host proteins, interaction seeds, ID registries | `interactions`, `interaction_evidence`, updated dataset/sample, SQLite tables, registries |
| Analysis | `analyze_interactions.py` | Validated dataset interactions/evidence | `data/derived/interaction_analysis.json` |

Run order matters: proteins expect the pathogens dataset, interactions expect resolved proteins,
and analysis expects the interaction table. Details are in `docs/DATA_PIPELINE.md`.

## Caching

- API caches live under `data/sources/` and are safe to delete; they are regenerable.
- `--refresh` ignores cached responses; `--no-network` uses only cached data and fails if a
  required cache file is missing.
- Caches exist for reproducibility and offline builds, not as curated data.
- Planned analysis caches belong under `data/derived/` and must key on input version/hash,
  module version, parameters and reference-resource versions.

## Conventions

- Curated sources live in `data/sources/`; generated artifacts live in `data/`.
- Join by stable IDs (`entity_id`; optional integer keys `pathogen_id`, `host_protein_id`), never
  display names.
- Keep derived or model outputs out of the curated dataset.
- Update `docs/DATASET.md` when the schema changes and `docs/ANALYSES.md` when module behaviour
  changes.
- One authoritative document per subject; see `docs/README.md`.

# Architecture

PathoMap has two independent concerns: a static browser application (presentation) and an
offline Python build pipeline (data production). Analysis engines are planned; they are not
implemented yet.

## System overview

```
data/sources/ (curated seeds + API caches)
    -> scripts/build_pathogens.py (NCBI enrichment)
    -> data/pathomap-dataset.json
    -> scripts/build_effectors_host_proteins.py (UniProt/InterPro/Pfam/STRING)
    -> data/pathomap-dataset.json + data/sample-dataset.json
    -> data/pathomap.db + data/schema.sql

index.html -> js/main.js -> js/data/loader.js -> js/views/database.js
                                       \-> js/analysis/* (planned) -> js/views/analyses/* (planned)
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
│   │   └── schema.js           # Columns, labels, enums, data dictionary
│   ├── ui/
│   │   └── upload.js           # Upload, built-in, sample and template loading
│   ├── utils/
│   │   └── dataset.js          # Upload validation + normalization
│   ├── views/
│   │   └── database.js         # Tables, tabs, search, sort, pagination, CSV, schema panel
│   └── analysis/               # (planned) registry, orchestrator, engines
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

**Data flow:** `index.html` → `main.js` → `loader.js` (fetch JSON) → `database.js` (render) with
`upload.js` replacing the in-memory dataset after validation.

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
| Database tables | `pathogens` (53), `effectors` (246), `host_proteins` (20) |
| Navigation | Home and Database only (`index.html`) |
| Generated analyses | Not implemented; no `js/analysis/` layer |
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
- See `docs/ANALYSES.md` for module specs and `docs/ROADMAP.md` for delivery order.

## Build pipeline

| Stage | Script | Inputs | Outputs |
|---|---|---|---|
| Pathogens | `build_pathogens.py` | `pathogens_seed.json`, `pathogen_overrides.json`, NCBI APIs | `pathomap-dataset.json`, `pathomap.db`, `schema.sql`, `schema/pathogens.schema.json` |
| Proteins | `build_effectors_host_proteins.py` | `effectors_seed.json`, `host_proteins_seed.json`, `effector_uniprot_mapping.json`, UniProt/InterPro/Pfam/STRING APIs | Updated `pathomap-dataset.json`, `sample-dataset.json`, `pathomap.db`, `schema.sql` |

Run order matters: the protein build expects the pathogens dataset to exist. Details of the
protein enrichment are in `docs/DATA_PIPELINE.md`.

## Caching

- API caches live under `data/sources/` and are safe to delete; they are regenerable.
- `--refresh` ignores cached responses; `--no-network` uses only cached data and fails if a
  required cache file is missing.
- Caches exist for reproducibility and offline builds, not as curated data.
- Planned analysis caches belong under `data/derived/` and must key on input version/hash,
  module version, parameters and reference-resource versions.

## Conventions

- Curated sources live in `data/sources/`; generated artifacts live in `data/`.
- Join by stable IDs (`pathogen_id`, later `effector_id`, `host_protein_id`), never display names.
- Keep derived or model outputs out of the curated dataset.
- Update `docs/DATASET.md` when the schema changes and `docs/ANALYSES.md` when module behaviour
  changes.
- One authoritative document per subject; see `docs/README.md`.

# Structure

Minimal v2 scaffold. Add one slice at a time.

## File tree

```
host-pathogen-tracker/
├── assets/
├── css/
│   ├── base.css
│   ├── layout.css
│   ├── components.css
│   └── utilities.css
├── data/
│   ├── archive/v1/             # v1 flat dataset and SQLite DB (not loaded)
│   ├── schema/                 # generated JSON Schema
│   ├── sources/                # curated seed, overrides, NCBI cache
│   ├── pathomap-dataset.json   # generated, loaded by the app
│   ├── sample-dataset.json     # generated
│   ├── pathomap.db             # generated SQLite database
│   └── schema.sql              # generated SQLite DDL
├── docs/
│   ├── DATASET.md
│   ├── IA.md
│   ├── ROADMAP.md
│   └── STRUCTURE.md
├── js/
│   ├── data/
│   │   ├── loader.js           # fetch + in-memory dataset
│   │   └── schema.js           # columns, labels, enums, data dictionary
│   ├── ui/
│   │   └── upload.js           # file, built-in, sample, template
│   ├── utils/
│   │   └── dataset.js          # validation + normalization
│   ├── views/
│   │   └── database.js         # table, tabs, CSV, schema panel
│   └── main.js
├── scripts/
│   └── build_pathogens.py      # NCBI enrichment, validation, exports
├── index.html
└── README.md
```

## Rules

- One feature per slice; do not copy whole files from the archive.
- Curated sources live in `data/sources/`; generated artifacts in `data/`.
- Join by stable IDs (`pathogen_id`, later `effector_id`, `host_protein_id`), never by display names.
- Keep derived or model outputs out of the curated dataset; put them under `data/derived/` when added.
- Update `docs/DATASET.md` whenever the schema changes.
- Do not commit unless explicitly asked.

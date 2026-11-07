# Data Directory

Reference for the data tree. Schema details live in `docs/DATASET.md`; the build pipeline lives
in `docs/DATA_PIPELINE.md`.

## Layout

```
data/
├── pathomap-dataset.json        # generated; loaded by the app
├── sample-dataset.json          # generated; 5 pathogens, 27 effectors, 20 host proteins
├── pathomap.db                  # generated SQLite database
├── schema.sql                   # generated SQLite DDL
├── classification-mapping.json  # manually maintained classification map
├── schema/
│   └── pathogens.schema.json    # generated JSON Schema
└── sources/                     # curated seeds + API caches (see sources/README.md)
```

## Generated vs curated

**Generated — do not edit by hand.** Rebuild with the scripts below:

- `pathomap-dataset.json` — `{ meta, pathogens, effectors, host_proteins }`
- `sample-dataset.json` — deterministic subset used by **Load Built-in Sample**
- `pathomap.db`, `schema.sql` — SQLite mirror of the JSON dataset
- `schema/pathogens.schema.json`

**Manually maintained:**

- `classification-mapping.json` — maps host targets, effector types and mechanisms to
  standardized categories.
- Everything under `sources/` that is not a cache (see `sources/README.md`).

## Build

```powershell
python scripts/build_pathogens.py
python scripts/build_effectors_host_proteins.py --enrich-effectors
```

Common flags: `--check`, `--refresh`, `--no-network`. Outputs and enrichment rules:
`docs/DATA_PIPELINE.md`.

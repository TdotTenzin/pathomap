# PathoMap v2

A curated host–pathogen dataset and browser, rebuilt from the bottom up.

## Current release

The database currently contains a single **pathogens** table: 54 organisms with NCBI taxonomy, representative genome assembly metadata, Gram reaction, acid-fast status, intracellular survival strategy, intracellular niche description, and the original curated descriptions. New fields include strain designation, secondary strategy, strategy evidence, NCBI scientific name, and curation notes.

The v1 flat dataset is archived in `data/archive/v1/` and is not loaded by the site. Effector, host-protein, interaction, and trafficking tables will be rebuilt one at a time.

## Run

Serve the directory over HTTP so the browser can fetch the JSON dataset:

```powershell
python -m http.server 8000
```

Open <http://localhost:8000>.

## Data

- `data/pathomap-dataset.json` — generated dataset loaded by the app
- `data/sample-dataset.json` — five-pathogen sample
- `data/pathomap.db` — generated SQLite database
- `data/schema.sql` — SQLite DDL
- `data/sources/pathogens_seed.json` — curated base rows
- `data/sources/pathogen_overrides.json` — manual NCBI overrides

Rebuild and validate:

```powershell
python scripts/build_pathogens.py
python scripts/build_pathogens.py --check
```

See [docs/DATASET.md](docs/DATASET.md) for the schema, enrichment rules, and validation details.

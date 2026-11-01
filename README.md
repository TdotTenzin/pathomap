# PathoMap v2

A curated host–pathogen dataset and browser, rebuilt from the bottom up.

## Current release

The database currently contains three tables:
- **pathogens**: 53 organisms with NCBI taxonomy, representative genome assembly metadata, Gram reaction, acid-fast status, intracellular survival strategy, intracellular niche description, and the original curated descriptions. New fields include strain designation, secondary strategy, strategy evidence, NCBI scientific name, and curation notes.
- **effectors**: 246 effector proteins linked to pathogens by name
- **host_proteins**: 5 host proteins targeted by effectors

The v1 flat dataset is archived in `data/archive/v1/` and is not loaded by the site. Interaction and trafficking tables will be rebuilt one at a time.

## Run

Serve the directory over HTTP so the browser can fetch the JSON dataset:

```powershell
python -m http.server 8000
```

Open <http://localhost:8000>.

## Data

- `data/pathomap-dataset.json` — generated dataset loaded by the app
- `data/sample-dataset.json` — five-pathogen sample with 27 effectors and 5 host proteins
- `data/pathomap.db` — generated SQLite database
- `data/schema.sql` — SQLite DDL
- `data/sources/pathogens_seed.json` — curated base rows for pathogens
- `data/sources/pathogen_overrides.json` — manual NCBI overrides
- `data/sources/effectors_seed.json` — curated base rows for effectors
- `data/sources/host_proteins_seed.json` — curated base rows for host proteins

Rebuild and validate:

```powershell
python scripts/build_pathogens.py
python scripts/build_pathogens.py --check
python scripts/build_effectors_host_proteins.py
python scripts/build_effectors_host_proteins.py --check
```

See [docs/DATASET.md](docs/DATASET.md) for the schema, enrichment rules, and validation details.

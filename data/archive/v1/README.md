# PathoMap dataset archive: v1

These files are the original flat dataset exported from the v1 SQLite database. They are kept for reference and migration only.

- `pathomap-dataset.json` - the flat JSON export used by the v1 site (54 pathogens, plus effectors, host proteins, interactions, stages, markers, and derived analyses).
- `sample-dataset.json` - the v1 five-pathogen sample.
- `pathomap.db` - the v1 SQLite database. It retains the original foreign keys that were lost in the JSON export.
- `make_sample.py` - the old helper used to generate the five-pathogen sample.

The v2 application does **not** load anything from this directory. The current dataset lives in `data/pathomap-dataset.json` and is generated from `data/sources/` by `scripts/build_pathogens.py`.

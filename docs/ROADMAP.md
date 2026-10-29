# Roadmap

## Slice 1: Pathogens (current)
- [x] Archive the v1 flat dataset
- [x] Define a normalized, typed pathogens schema
- [x] Enrich taxonomy and representative genomes from NCBI
- [x] Validate rows and emit JSON, SQLite, SQL, and JSON Schema
- [x] Pathogens-only database view with sort, search, CSV, and data dictionary
- [x] Upload a pathogens JSON or load the built-in dataset/sample
- [ ] Second pathogens pass: lifestyle, replication niche, host range, transmission, disease, BSL

## Slice 2: Effectors
- [ ] Add sequences, cross-references, secretion system, effector class, and evidence
- [ ] Add computed sequence features in a separate table
- [ ] Link effectors to pathogens by `pathogen_id`

## Slice 3: Host proteins
- [ ] Add UniProt/GO/KEGG identifiers and remove non-protein compartment entries
- [ ] Link stage markers to `host_protein_id`

## Slice 4: Interactions
- [ ] Add controlled interaction types, direction, evidence method, and per-row references
- [ ] Link effectors and host proteins by ID

## Slice 5: References and derived analyses
- [ ] Normalize references into their own table
- [ ] Move ML predictions, PCA, classifiers, phylogeny, and hubs into `data/derived/`
- [ ] Report model metrics and splits honestly (leave-one-pathogen-out)

# Documentation Index

One authoritative document per subject. When a topic changes, update its owner and link here
instead of duplicating content elsewhere.

| Subject | Authoritative document |
|---|---|
| System design, frontend modules, navigation | `ARCHITECTURE.md` |
| Table schemas, relationships, provenance, schema history | `DATASET.md` |
| Seed → dataset build, API enrichment, caching, rate limits | `DATA_PIPELINE.md` |
| Analysis modules, evidence classes, provenance rules | `ANALYSES.md` |
| Priorities, phases, implementation status | `ROADMAP.md` |
| Effector sequence features and backlog | `SEQUENCE_FEATURES.md` |
| Data directory reference | `../data/README.md` |
| Seed files and API cache reference | `../data/sources/README.md` |
| NCBI cache reference | `../data/sources/ncbi/README.md` |

## Placement rules

- Curated data facts → `DATASET.md`.
- How data is fetched or built → `DATA_PIPELINE.md`.
- How the app is structured or navigated → `ARCHITECTURE.md`.
- What an analysis module should compute → `ANALYSES.md`.
- When work happens → `ROADMAP.md`.
- Feature-level sequence detail → `SEQUENCE_FEATURES.md`.

Do not restate a topic in a second document; link to its owner.

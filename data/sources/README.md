# Sources Directory

Curated seed files and regenerable API caches. The build pipeline and enrichment rules are
documented in `docs/DATA_PIPELINE.md`; schemas are in `docs/DATASET.md`.

## Curated files (source of truth)

| File | Contents |
|---|---|
| `pathogens_seed.json` | Base pathogen records |
| `effectors_seed.json` | Effector records linked to pathogens |
| `host_proteins_seed.json` | Host protein reference records |
| `pathogen_overrides.json` | Manual NCBI lookup overrides (pinned accessions, name fixes) |
| `effector_uniprot_mapping.json` | Effector name → UniProt accession |
| `effector_ids.json` | Persistent effector entity-ID registry (assigned once, never reused) |
| `interaction_evidence_seed.json` | Optional manually curated interaction-evidence records |
| `interaction_ids.json` | Persistent normalized interaction-ID registry (`PM-INT`) |
| `interaction_evidence_ids.json` | Persistent interaction-evidence ID registry (`PM-EVD`) |
| `../classification-mapping.json` | Classification categories (lives one level up) |

### Effector ID registry

Keys are `"<pathogen_id>|<effector_name>"` and values are `PM-EFF-…` identifiers. The build keeps
existing assignments and appends new ones in deterministic `(pathogen_id, effector_name)` order;
it never renumbers or reuses an ID. Commit this file with effector seed changes so identifiers
stay stable across machines and builds.

### Interaction evidence

The interaction build creates conservative `annotation-derived` records from
audited single-protein target resolutions. To add experimental, predicted or
hypothetical support, append an object to the `evidence` list in
`interaction_evidence_seed.json` with `effector_id`, `host_protein_id`,
`evidence_class`, `provenance`, and optional `doi`, `pmid`,
`database_accession` and `note`. Multiple evidence records may share one
effector/host-protein pair.

### Effector UniProt mapping

Keys are either `"Effector"` or `"Effector|Pathogen name"`. Use the qualified key when the same
effector name occurs in more than one pathogen (for example `OmpA` in *Acinetobacter baumannii*
and *Escherichia coli K1*).

If an effector is not mapped, the build searches UniProt by effector name + pathogen name and
keeps only organism-matching hits. If nothing matches, the curated row is kept unenriched and a
warning is logged.

## API caches (regenerable)

| Directory | Contents |
|---|---|
| `ncbi/` | Taxonomy and genome responses (see `ncbi/README.md`) |
| `uniprot/entries/` | Full UniProt entries |
| `uniprot/search/` | Effector name → accession searches |
| `interpro/matches/` | InterPro domain matches |
| `pfam/matches/` | Pfam domain matches |
| `string/ids/` | UniProt → STRING id resolution |
| `string/interactions/` | STRING interaction networks |

Caches are safe to delete. `--refresh` ignores them; `--no-network` requires them.

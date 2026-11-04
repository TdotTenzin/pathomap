# API Enrichment Pipeline

## Overview

The build pipeline enriches manually curated seed data with external API calls to:

- **UniProt** — protein sequences, molecular features, domains, GO terms, pathways
- **InterPro / Pfam** — domain annotations with coordinates (when UniProt has no `Domain` features)
- **STRING** — protein-protein interaction partners (host proteins)

All enrichment happens in `scripts/build_effectors_host_proteins.py`, which calls the
reusable clients in `scripts/api_clients.py`.

## Architecture

```
Seed Files (JSON)
    ↓
API Enrichment (scripts/api_clients.py)
    ↓
Cached API Responses (data/sources/uniprot/, interpro/, pfam/, string/)
    ↓
Merged Dataset (data/pathomap-dataset.json, data/pathomap.db)
```

## What Gets Enriched

### Host proteins (always)

Records already carry `uniprot_id`, so enrichment is direct:

| Field | Source |
|-------|--------|
| `sequence`, `sequence_length` | UniProt |
| `molecular_weight_da`, `isoelectric_point`, `gravy_score` | Calculated from sequence |
| `domains` | UniProt features → InterPro/Pfam API → UniProt cross-references |
| `go_terms` | UniProt GO cross-references |
| `pathways_detailed` | UniProt KEGG/Reactome cross-references |
| `interacting_partners` | STRING (`required_score=700`) |

### Effectors (opt-in via `--enrich-effectors`)

Effector names are resolved to accessions through
`data/sources/effector_uniprot_mapping.json`, with a UniProt search fallback
(effector name + pathogen name, organism-verified). In addition to the fields
above, effectors get `signal_peptide` and `transmembrane_regions`.

Records that cannot be resolved keep their curated seed data and are logged as
warnings; host proteins whose UniProt fetch fails are marked
`curation_status: "needs_review"`.

## Usage

```powershell
# Host-protein enrichment only (default)
python scripts/build_effectors_host_proteins.py

# Also enrich effectors (mapping file + search fallback)
python scripts/build_effectors_host_proteins.py --enrich-effectors

# Force fresh API calls (ignore cache)
python scripts/build_effectors_host_proteins.py --enrich-effectors --refresh

# Use only cached data (no network)
python scripts/build_effectors_host_proteins.py --enrich-effectors --no-network

# Validate without writing output files
python scripts/build_effectors_host_proteins.py --enrich-effectors --check
```

## Caching

All API responses are cached in `data/sources/` to:

- Avoid repeated API calls during development
- Enable offline builds with `--no-network`
- Maintain reproducibility

Cache structure:

- `data/sources/uniprot/entries/{accession}.json` — full UniProt entries
- `data/sources/uniprot/sequences/{accession}.json` — sequence-only responses
- `data/sources/uniprot/search/{query}.json` — effector name → accession searches
- `data/sources/interpro/matches/{accession}.json` — InterPro domain matches
- `data/sources/pfam/matches/{accession}.json` — Pfam domain matches
- `data/sources/string/ids/{accession}.json` — UniProt → STRING id resolution
- `data/sources/string/interactions/{accession}.json` — STRING interaction networks

## Rate Limits

- UniProt: ~200 requests/second (no key required)
- InterPro / EBI: ~10 requests/second
- STRING: ~5 requests/second

`api_clients.py` throttles per-host request spacing and retries failed requests
3 times with exponential backoff.

## Error Handling

If an API call fails:

1. Retry up to 3 times with backoff
2. Log a warning and continue with the next record
3. Mark affected host-protein records as `curation_status: "needs_review"`
4. Fall back to cached data when `--no-network` is set

Enrichment failures never abort the build; validation still runs on whatever
fields are present (sequence alphabet, numeric feature types, list types).

## Adding New APIs

1. Add a fetch function to `scripts/api_clients.py`
2. Add its cache directory under `data/sources/`
3. Integrate it into `build_effectors_host_proteins.py`
4. Add validation for the new fields in `validate_enriched_records()`
5. Add column metadata in `js/data/schema.js` and normalization in `js/utils/dataset.js`
6. Document the data source here

## Field Notes

- `domains`: `{"name", "accession", "start", "end"}` — coordinates present when
  the annotation came from UniProt features or the InterPro/Pfam APIs.
- `go_terms`: `{"id", "term", "aspect"}` where aspect is `F`/`P`/`C`.
- `pathways_detailed`: `{"database", "id", "name"}` (KEGG or Reactome).
- `interacting_partners`: `{"string_id", "name", "score"}` — STRING does not
  return UniProt accessions for partners, so the STRING protein id is stored.
- `signal_peptide`: `{"start", "end"}` or `null`.
- `transmembrane_regions`: `[{"start", "end"}, ...]`.

# Sources Directory

Manually curated seed files and API caches used by the build scripts.

## Seed Files

- `pathogens_seed.json` — curated pathogen records (primary source of truth)
- `effectors_seed.json` — effector records linked to pathogens
- `host_proteins_seed.json` — host protein reference records
- `pathogen_overrides.json` — manual NCBI lookup overrides
- `classification-mapping.json` — (lives one level up) effector classification categories

## Effector UniProt Mapping

`effector_uniprot_mapping.json` maps effector names to UniProt accessions for
API enrichment.

### Format

```json
{
  "effector_name": "uniprot_accession",
  "Effector|Pathogen name": "uniprot_accession"
}
```

Use the qualified `"Effector|Pathogen name"` key when the same effector name is
used by more than one pathogen (for example `OmpA` in both *Acinetobacter
baumannii* and *Escherichia coli K1*).

### Adding New Mappings

1. Search UniProt (https://www.uniprot.org/) for the effector protein
2. Filter by organism (pathogen name)
3. Copy the UniProt accession (e.g., `P00588`)
4. Add it to this JSON file

### Fallback Behavior

If an effector is not in this mapping file, the build script will:

1. Search UniProt by effector name + pathogen name
2. Keep the first result whose organism matches the pathogen
3. Log a warning if no organism-matching results are found (the effector stays
   unenriched)

For best results, manually curate the mapping file.

## API Caches

- `ncbi/` — NCBI Taxonomy and NCBI Datasets responses (see `ncbi/README.md`)
- `uniprot/` — UniProt entries, sequences, and search results
- `interpro/matches/` — InterPro domain matches
- `pfam/matches/` — Pfam domain matches
- `string/ids/`, `string/interactions/` — STRING id resolution and interaction networks

Caches make builds reproducible and allow offline runs with `--no-network`.
See `docs/API_ENRICHMENT.md` for details.

# NCBI API Cache

This directory contains cached responses from NCBI APIs to avoid repeated network calls during dataset building.

## Directory Structure

```
ncbi/
├── genomes/              # Genome assembly data from NCBI Datasets API
├── taxonomy/             # Taxonomy lineage data from NCBI Taxonomy database
└── taxonomy_search/      # Search results for name-to-tax_id resolution
```

## Cache Files

### genomes/

Genome assembly data fetched from the NCBI Datasets API (`https://api.ncbi.nlm.nih.gov/datasets/v2alpha/`).

**File naming**: `{pathogen_id}-{tax_id}.json` or `{pathogen_id}-{tax_id}-refseq.json`

- The `-refseq.json` variant is used when the build script specifically queries RefSeq assemblies.
- Both files may exist for the same pathogen if multiple queries were attempted.

**Content**: Assembly metadata including:
- Accession numbers (RefSeq and GenBank)
- Assembly level (Complete Genome, Chromosome, Scaffold, Contig)
- Assembly stats (size, GC content, contig count)
- Organism information (strain, serovar)
- Annotation statistics

### taxonomy/

Taxonomy lineage data fetched from the NCBI Taxonomy database via E-utilities.

**File naming**: `{tax_id}.json`

**Content**: Taxonomic classification including:
- Scientific name
- Taxonomic rank
- Full lineage (domain, phylum, class, order, family, genus, species)

### taxonomy_search/

Search results from NCBI E-utilities to resolve pathogen names to NCBI tax IDs.

**File naming**: `{pathogen_id}-{sanitized-name}.json`

**Content**: ESearch results containing:
- The tax_id for the queried organism name
- Query translation information
- Error information if the search failed

**Note**: Failed searches (count: 0) are automatically removed during cleanup.

## Cache Management

The cache is managed by `scripts/build_pathogens.py`:

- **Default behavior**: Uses cached data if available and recent
- **`--refresh` flag**: Forces fresh API calls and updates the cache
- **`--no-network` flag**: Uses only cached data, fails if cache is missing

## Manual Cleanup

To clean up the cache:

1. Remove failed search results from `taxonomy_search/` (files with `"count": "0"`)
2. Remove duplicate genome files if both regular and `-refseq.json` exist and are not needed
3. Delete entire cache directories to force rebuild: `rm -rf data/sources/ncbi/*`

## Adding New Pathogens

When adding a new pathogen to `curated_data.json`:

1. Run `python scripts/build_pathogens.py --refresh` to fetch fresh NCBI data
2. The script will automatically create new cache files for the new pathogen
3. If the pathogen name doesn't match NCBI's database, add an override in `pathogen_overrides.json`

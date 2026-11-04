# PathoMap v2

A curated host–pathogen dataset and browser, rebuilt from the bottom up.

## Overview

PathoMap is a web-based database browser for studying host–pathogen interactions. It catalogs bacterial pathogens, their effector proteins, and the host proteins they target, with enriched NCBI taxonomy and genome metadata.

**Current dataset:**
- **pathogens**: 53 organisms with NCBI taxonomy, genome assembly metadata, Gram reaction, acid-fast status, intracellular survival strategy, and curated descriptions
- **effectors**: 246 effector proteins linked to pathogens
- **host_proteins**: 20 host proteins targeted by effectors

The application is a vanilla JavaScript single-page application with no build step or external dependencies.

---

## Directory Structure

```
host-pathogen-tracker/
├── README.md                      # This file
├── index.html                     # Main entry point (HTML structure)
├── opencode.json                  # Project metadata
├── plans.md                       # Development planning notes
│
├── css/                           # Stylesheets (loaded in order)
│   ├── base.css                   # Base styles, variables, typography
│   ├── layout.css                 # Layout structure (header, main, footer)
│   ├── components.css             # UI component styles (tables, badges, upload)
│   └── utilities.css              # Utility classes (spacing, colors, etc.)
│
├── js/                            # JavaScript application code
│   ├── main.js                    # Application entry point and initialization
│   ├── data/                      # Data loading and schema definitions
│   │   ├── loader.js              # Dataset fetching, caching, and initial loading
│   │   └── schema.js              # Schema metadata (columns, enums, validation rules)
│   ├── utils/                     # Utility functions
│   │   └── dataset.js            # Validation and normalization of uploaded datasets
│   ├── ui/                        # UI components
│   │   └── upload.js              # File upload interface and validation
│   └── views/                     # Page views
│       └── database.js            # Main database browser view (tables, search, filters)
│
├── data/                          # Data files (see data/README.md for details)
│   ├── README.md                  # Data directory documentation
│   ├── pathomap-dataset.json      # Main production dataset (generated)
│   ├── sample-dataset.json        # Sample dataset for testing (5 pathogens)
│   ├── pathomap.db                # SQLite database (generated)
│   ├── schema.sql                 # SQL schema definition (generated)
│   ├── classification-mapping.json # Classification mappings for categorization
│   ├── schema/                    # JSON Schema definitions
│   │   └── pathogens.schema.json  # Schema validation for pathogens dataset
│   └── sources/                  # Source data for build pipeline
│       ├── README.md             # Source file docs (incl. effector UniProt mapping)
│       ├── pathogens_seed.json   # Curated pathogen data (manually maintained)
│       ├── effectors_seed.json    # Effector data
│       ├── host_proteins_seed.json # Host protein reference data
│       ├── pathogen_overrides.json # Manual overrides for NCBI lookups
│       ├── effector_uniprot_mapping.json # Effector name -> UniProt accession
│       ├── ncbi/                  # NCBI API cache
│       │   ├── README.md          # Cache documentation
│       │   ├── genomes/           # Genome assembly data from NCBI Datasets
│       │   ├── taxonomy/          # Taxonomy lineage data
│       │   └── taxonomy_search/   # Search results for name-to-tax_id resolution
│       ├── uniprot/               # UniProt API cache (entries/sequences/search)
│       ├── interpro/matches/      # InterPro domain annotation cache
│       ├── pfam/matches/          # Pfam domain annotation cache
│       └── string/                # STRING interaction cache
│
├── scripts/                       # Build scripts (Python)
│   ├── build_pathogens.py         # Build pathogens table with NCBI enrichment
│   ├── build_effectors_host_proteins.py # Build effectors and host_proteins tables
│   └── api_clients.py             # UniProt/InterPro/Pfam/STRING API clients
│
└── docs/                          # Documentation
    ├── DATASET.md                 # Dataset schema, enrichment rules, validation
    ├── API_ENRICHMENT.md          # Protein API enrichment pipeline
    ├── ROADMAP.md                 # Project roadmap and future plans
    ├── STRUCTURE.md               # Technical architecture details
    └── IA.md                      # Information architecture notes
```

---

## Code Architecture

### Frontend Architecture

The application follows a modular vanilla JavaScript architecture:

```
index.html
    ↓
js/main.js (entry point)
    ↓
js/data/loader.js (load dataset)
    ↓
js/views/database.js (render UI)
    ↓
js/ui/upload.js (handle uploads)
```

**Key Modules:**

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `js/main.js` | Application initialization, event routing | `init()`, route event handlers |
| `js/data/loader.js` | Fetch dataset from server, cache in memory | `loadDataset()`, `setDataset()` |
| `js/data/schema.js` | Schema metadata for all tables | `COLUMN_META`, `EFFECTOR_COLUMNS_META`, `HOST_PROTEIN_COLUMNS_META`, `ENUMS` |
| `js/utils/dataset.js` | Validate and normalize user uploads | `validateDataset()`, `normalizeDataset()` |
| `js/ui/upload.js` | File upload UI and validation flow | `handleUpload()`, display validation results |
| `js/views/database.js` | Main database browser view | Render tables, handle search/filter, pagination |

**Data Flow:**

1. **Loading**: `loader.js` fetches `pathomap-dataset.json` from server
2. **Validation**: User uploads are validated by `dataset.js` against schema
3. **Rendering**: `database.js` uses `schema.js` metadata to render tables
4. **Caching**: Dataset is cached in memory to avoid re-fetching

### Build Pipeline

The build pipeline transforms manually curated source data into production datasets:

```
data/sources/ (manual curation)
    ↓
scripts/build_pathogens.py (NCBI enrichment)
    ↓
data/pathomap-dataset.json (production)
    ↓
scripts/build_effectors_host_proteins.py (add effectors/host proteins)
    ↓
data/pathomap-dataset.json (final)
```

**Build Scripts:**

| Script | Input | Output | Purpose |
|--------|-------|--------|---------|
| `build_pathogens.py` | `pathogens_seed.json`, NCBI APIs | `pathomap-dataset.json`, `pathomap.db`, `schema.sql` | Enrich curated data with NCBI taxonomy and genome metadata |
| `build_effectors_host_proteins.py` | `effectors_seed.json`, `host_proteins_seed.json`, UniProt/InterPro/Pfam/STRING APIs | Updated `pathomap-dataset.json`, `pathomap.db`, `schema.sql` | Add effectors and host proteins, enriched with protein sequence/annotation data |
| `api_clients.py` | — | API cache under `data/sources/` | Reusable, cached API clients shared by the enrichment build |

**NCBI Integration:**

The build script automatically fetches data from NCBI APIs:
- **NCBI Taxonomy**: Fetches lineage (phylum, class, order, family) for each pathogen
- **NCBI Datasets**: Fetches genome assembly metadata (accession, size, GC content, assembly level)
- **Caching**: Responses are cached in `data/sources/ncbi/` to avoid repeated API calls

**Protein API Enrichment:**

`build_effectors_host_proteins.py` enriches curated protein records:
- **UniProt**: Sequences, GO terms, pathways, domain features
- **Calculated**: Molecular weight, isoelectric point (pI), GRAVY, sequence length
- **InterPro/Pfam**: Domain annotations with coordinates (when UniProt lacks them)
- **STRING**: Protein-protein interaction partners (host proteins)
- **Caching**: Responses are cached in `data/sources/uniprot/`, `interpro/`, `pfam/`, `string/`

See [docs/API_ENRICHMENT.md](docs/API_ENRICHMENT.md) for details.

---

## Key Files Explained

### Application Files

| File | Purpose | Why It Matters |
|------|---------|----------------|
| `index.html` | HTML structure for the single-page app | Defines the DOM layout, loads CSS/JS modules |
| `js/main.js` | Application entry point | Initializes the app, sets up event listeners |
| `js/data/schema.js` | Schema definitions | Central source of truth for table structure, columns, and enum values |
| `js/data/loader.js` | Dataset loading | Handles fetching, caching, and initial validation of the dataset |
| `js/views/database.js` | Main UI view | Renders the database browser, tables, search, and filters |
| `js/utils/dataset.js` | Upload validation | Ensures user uploads match the expected schema |
| `js/ui/upload.js` | Upload interface | Provides drag-and-drop upload and displays validation results |

### Data Files

| File | Purpose | Generated By |
|------|---------|--------------|
| `data/pathomap-dataset.json` | Main production dataset | `build_pathogens.py` + `build_effectors_host_proteins.py` |
| `data/sample-dataset.json` | Sample dataset (5 pathogens) | Build scripts (subset of main dataset) |
| `data/pathomap.db` | SQLite database | `build_pathogens.py` |
| `data/schema.sql` | SQL schema definition | `build_pathogens.py` |
| `data/classification-mapping.json` | Classification mappings | Manually maintained (used for categorization) |

### Source Data Files

| File | Purpose | Maintenance |
|------|---------|-------------|
| `data/sources/pathogens_seed.json` | Curated pathogen data | Manually edited (primary source of truth) |
| `data/sources/effectors_seed.json` | Effector data | Manually edited |
| `data/sources/host_proteins_seed.json` | Host protein data | Manually edited |
| `data/sources/pathogen_overrides.json` | Manual NCBI overrides | Manually edited (for problematic lookups) |
| `data/sources/effector_uniprot_mapping.json` | Effector → UniProt accession mapping | Manually curated (see data/sources/README.md) |

### Build Scripts

| Script | Purpose | Dependencies |
|--------|---------|--------------|
| `scripts/build_pathogens.py` | Build pathogens table with NCBI data | Python 3, internet connection (for NCBI APIs) |
| `scripts/build_effectors_host_proteins.py` | Add effectors and host proteins with protein enrichment | Python 3, existing pathogens dataset, internet (UniProt/InterPro/STRING, optional) |

---

## Running the Application

### Development Server

Serve the directory over HTTP (required for browser to fetch JSON):

```powershell
python -m http.server 8000
```

Open <http://localhost:8000> in your browser.

### Building the Dataset

**Rebuild the complete dataset:**

```powershell
# Build pathogens table with NCBI enrichment
python scripts/build_pathogens.py

# Add effectors and host proteins with API enrichment
python scripts/build_effectors_host_proteins.py --enrich-effectors
```

**Build without API enrichment (manual only):**

```powershell
python scripts/build_effectors_host_proteins.py
```

**Validate without rebuilding:**

```powershell
python scripts/build_pathogens.py --check
python scripts/build_effectors_host_proteins.py --check
```

**Refresh API cache (force fresh API calls):**

```powershell
python scripts/build_pathogens.py --refresh
python scripts/build_effectors_host_proteins.py --enrich-effectors --refresh
```

**Use only cached data (no network):**

```powershell
python scripts/build_pathogens.py --no-network
python scripts/build_effectors_host_proteins.py --enrich-effectors --no-network
```

---

## Documentation

- **[docs/DATASET.md](docs/DATASET.md)** - Detailed schema documentation, enrichment rules, and validation details
- **[docs/API_ENRICHMENT.md](docs/API_ENRICHMENT.md)** - Protein API enrichment pipeline (UniProt, InterPro, Pfam, STRING)
- **[docs/STRUCTURE.md](docs/STRUCTURE.md)** - Technical architecture and data flow
- **[docs/ROADMAP.md](docs/ROADMAP.md)** - Project roadmap and future plans
- **[data/README.md](data/README.md)** - Data directory structure and file purposes
- **[data/sources/README.md](data/sources/README.md)** - Source files, effector UniProt mapping, and API caches
- **[data/sources/ncbi/README.md](data/sources/ncbi/README.md)** - NCBI cache documentation

---

## Technology Stack

- **Frontend**: Vanilla JavaScript (ES6 modules), HTML5, CSS3
- **Backend**: None (static files served by HTTP server)
- **Data**: JSON (primary), SQLite (generated)
- **Build**: Python 3 scripts
- **External APIs**: NCBI Taxonomy, NCBI Datasets, UniProt, InterPro/Pfam, STRING (for enrichment)

---

## Contributing

When adding new pathogens:

1. Edit `data/sources/pathogens_seed.json` to add the new pathogen
2. Run `python scripts/build_pathogens.py --refresh` to fetch fresh NCBI data
3. If the pathogen name doesn't match NCBI's database, add an override in `data/sources/pathogen_overrides.json`
4. Add corresponding effectors to `data/sources/effectors_seed.json`
5. If the effector has a known UniProt entry, add it to `data/sources/effector_uniprot_mapping.json`
6. Run `python scripts/build_effectors_host_proteins.py --enrich-effectors` to update the dataset

See [data/README.md](data/README.md) and [data/sources/ncbi/README.md](data/sources/ncbi/README.md) for more details.

-- ===========================================================================
-- schema.sql - SQLite DDL for the PathoMap v2 database (data/pathomap.db)
--
-- Purpose: Defines the relational schema that mirrors the JSON dataset
-- (data/pathomap-dataset.json). The site loads JSON, not this DB directly,
-- but the SQLite file is exported alongside it for programmatic queries and
-- the "Data dictionary" links in the UI.
--
-- Tables:
--   pathogens  One row per organism: taxonomy (NCBI), Gram reaction,
--              acid-fast flag, intracellular survival strategy, representative
--              genome assembly metadata, curation status, and provenance.
--   meta       Simple key/value store for dataset-level metadata (schema
--              version, build timestamp, row counts, etc.).
--
-- Constraints:
--   - CHECK constraints on gram_stain, strategy, assembly_level, and
--     curation_status mirror the enum lists in js/data/schema.js.
--   - pathogen_id is the primary key; name and tax_id are UNIQUE and NOT NULL.
--
-- Indexes:
--   idx_pathogens_strategy, idx_pathogens_gram_stain, idx_pathogens_tax_id
--   speed up the common filter/sort columns used in the UI.
--
-- Note: This DDL is generated/validated by the build scripts (see README);
-- edit js/data/schema.js first if you need to change the canonical field set,
-- then regenerate this file and the SQLite DB.
-- ===========================================================================

-- PathoMap v2 pathogens schema
CREATE TABLE pathogens (
  pathogen_id        INTEGER PRIMARY KEY,
  name               TEXT    NOT NULL UNIQUE,
  genus              TEXT    NOT NULL,
  species            TEXT    NOT NULL,
  serovar            TEXT,
  strain             TEXT,
  tax_id             INTEGER NOT NULL UNIQUE,
  ncbi_scientific_name TEXT NOT NULL,
  family             TEXT    NOT NULL,
  order_name         TEXT    NOT NULL,
  class_name         TEXT    NOT NULL,
  phylum             TEXT    NOT NULL,
  gram_stain         TEXT    NOT NULL CHECK (gram_stain IN ('Gram-positive', 'Gram-negative', 'Gram-variable', 'unknown')),
  acid_fast          INTEGER NOT NULL CHECK (acid_fast IN (0, 1)),
  strategy           TEXT    NOT NULL CHECK (strategy IN ('arrest', 'escape', 'reroute', 'modified_compartment', 'extracellular', 'unknown')),
  strategy_secondary TEXT,
  strategy_evidence  TEXT,
  intracellular_niche TEXT,
  genome_accession   TEXT,
  assembly_level     TEXT    NOT NULL CHECK (assembly_level IN ('Complete Genome', 'Chromosome', 'Scaffold', 'Contig', 'unknown')),
  genome_size_mb     REAL,
  gc_content         REAL,
  n_contigs          INTEGER,
  reference_doi      TEXT    NOT NULL,
  description        TEXT    NOT NULL,
  curation_notes     TEXT,
  curation_status    TEXT    NOT NULL CHECK (curation_status IN ('curated', 'needs_review')),
  last_updated       TEXT    NOT NULL
);

-- Indexes for the most common filter/sort columns
CREATE INDEX idx_pathogens_strategy ON pathogens(strategy);
CREATE INDEX idx_pathogens_gram_stain ON pathogens(gram_stain);
CREATE INDEX idx_pathogens_tax_id ON pathogens(tax_id);

-- Key/value store for dataset-level metadata (schema_version, built_at, etc.)
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

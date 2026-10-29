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

CREATE INDEX idx_pathogens_strategy ON pathogens(strategy);
CREATE INDEX idx_pathogens_gram_stain ON pathogens(gram_stain);
CREATE INDEX idx_pathogens_tax_id ON pathogens(tax_id);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

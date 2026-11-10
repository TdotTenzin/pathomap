-- PathoMap v2.2 primary schema
CREATE TABLE pathogens (
  entity_id          TEXT    NOT NULL UNIQUE,
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

CREATE TABLE "references" (
  entity_id  TEXT PRIMARY KEY,
  doi        TEXT NOT NULL UNIQUE,
  url        TEXT NOT NULL
);

CREATE INDEX idx_references_doi ON "references"(doi);

CREATE TABLE pathogen_references (
  pathogen_id  INTEGER NOT NULL REFERENCES pathogens(pathogen_id) ON DELETE CASCADE,
  reference_id TEXT    NOT NULL REFERENCES "references"(entity_id) ON DELETE CASCADE,
  PRIMARY KEY (pathogen_id, reference_id)
);

CREATE INDEX idx_pathogen_references_ref ON pathogen_references(reference_id);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- PathoMap v2.2 derived tables schema
CREATE TABLE host_proteins (
  entity_id            TEXT    NOT NULL UNIQUE,
  host_protein_id      INTEGER PRIMARY KEY,
  protein_name          TEXT    NOT NULL,
  gene_name             TEXT    NOT NULL,
  uniprot_id           TEXT    NOT NULL UNIQUE,
  sequence              TEXT,
  sequence_length       INTEGER,
  molecular_weight_da   REAL,
  isoelectric_point     REAL,
  gravy_score           REAL,
  domains               TEXT,
  go_terms              TEXT,
  localization          TEXT    NOT NULL,
  function              TEXT    NOT NULL,
  pathway               TEXT,
  pathways_detailed     TEXT,
  interacting_partners  TEXT,
  reference_doi         TEXT,
  evidence_source       TEXT,
  last_updated          TEXT    NOT NULL
);

CREATE INDEX idx_host_proteins_uniprot_id ON host_proteins(uniprot_id);

CREATE TABLE host_targets (
  entity_id              TEXT    PRIMARY KEY,
  host_target_id         INTEGER NOT NULL UNIQUE,
  name                   TEXT    NOT NULL UNIQUE,
  host_target_class      TEXT    NOT NULL,
  host_protein_id        INTEGER,
  resolution_status      TEXT    NOT NULL CHECK (resolution_status IN ('resolved_protein', 'protein_family', 'protein_complex', 'ambiguous', 'non_protein', 'unresolved')),
  audit_status           TEXT    NOT NULL CHECK (audit_status IN ('verified_protein', 'verified_protein_family', 'verified_complex', 'ambiguous', 'non_protein', 'unresolved')),
  resolved_name          TEXT,
  gene_symbol            TEXT,
  uniprot_id             TEXT,
  aliases                TEXT,
  members                TEXT,
  evidence_sources       TEXT    NOT NULL,
  audit_notes            TEXT,
  FOREIGN KEY (host_protein_id) REFERENCES host_proteins(host_protein_id)
);

CREATE INDEX idx_host_targets_host_protein_id ON host_targets(host_protein_id);
CREATE INDEX idx_host_targets_class ON host_targets(host_target_class);
CREATE INDEX idx_host_targets_resolution ON host_targets(resolution_status);
CREATE INDEX idx_host_targets_uniprot_id ON host_targets(uniprot_id);

CREATE TABLE effectors (
  entity_id              TEXT    PRIMARY KEY,
  effector_name          TEXT    NOT NULL,
  effector_name_class    TEXT,
  pathogen_id            INTEGER NOT NULL,
  pathogen_name          TEXT    NOT NULL,
  host_target_id         INTEGER NOT NULL,
  host_target            TEXT    NOT NULL,
  host_target_class      TEXT,
  type                   TEXT    NOT NULL,
  type_class             TEXT,
  mechanism              TEXT    NOT NULL,
  mechanism_class        TEXT,
  uniprot_id             TEXT,
  sequence               TEXT,
  domains                TEXT,
  go_terms               TEXT,
  signal_peptide         TEXT,
  transmembrane_regions  TEXT,
  FOREIGN KEY (pathogen_id) REFERENCES pathogens(pathogen_id),
  FOREIGN KEY (host_target_id) REFERENCES host_targets(host_target_id)
);

CREATE INDEX idx_effectors_pathogen_id ON effectors(pathogen_id);
CREATE INDEX idx_effectors_pathogen_name ON effectors(pathogen_name);
CREATE INDEX idx_effectors_host_target_id ON effectors(host_target_id);

CREATE TABLE host_protein_references (
  host_protein_id INTEGER NOT NULL REFERENCES host_proteins(host_protein_id) ON DELETE CASCADE,
  reference_id    TEXT    NOT NULL REFERENCES "references"(entity_id) ON DELETE CASCADE,
  PRIMARY KEY (host_protein_id, reference_id)
);

CREATE TABLE effector_references (
  effector_id  TEXT NOT NULL REFERENCES effectors(entity_id) ON DELETE CASCADE,
  reference_id TEXT NOT NULL REFERENCES "references"(entity_id) ON DELETE CASCADE,
  PRIMARY KEY (effector_id, reference_id)
);

CREATE INDEX idx_host_protein_references_ref ON host_protein_references(reference_id);
CREATE INDEX idx_effector_references_ref ON effector_references(reference_id);
-- PathoMap v3.0 interaction evidence schema
CREATE TABLE interactions (
  interaction_id TEXT PRIMARY KEY,
  effector_id TEXT NOT NULL REFERENCES effectors(entity_id),
  host_protein_id TEXT NOT NULL REFERENCES host_proteins(entity_id),
  mechanism TEXT,
  interaction_type TEXT NOT NULL,
  provenance TEXT NOT NULL,
  UNIQUE (effector_id, host_protein_id)
);
CREATE INDEX idx_interactions_effector_id ON interactions(effector_id);
CREATE INDEX idx_interactions_host_protein_id ON interactions(host_protein_id);
CREATE TABLE interaction_evidence (
  evidence_id TEXT PRIMARY KEY,
  interaction_id TEXT NOT NULL REFERENCES interactions(interaction_id) ON DELETE CASCADE,
  evidence_class TEXT NOT NULL CHECK (evidence_class IN ('experimental', 'predicted', 'annotation-derived', 'hypothetical')),
  doi TEXT,
  pmid TEXT,
  database_accession TEXT,
  provenance TEXT NOT NULL,
  note TEXT
);
CREATE INDEX idx_interaction_evidence_interaction_id ON interaction_evidence(interaction_id);
CREATE INDEX idx_interaction_evidence_class ON interaction_evidence(evidence_class);

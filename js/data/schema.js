/*
  schema.js - Central schema definitions for the PathoMap dataset (v2.2).

  Purpose: Single source of truth for column metadata, enum values, visible
  column lists, and classification display labels. Every other module imports
  from here so column order, labels, and valid values stay consistent across
  the table view, CSV export, validation, and the data-dictionary panel.

  Exports (key groups):
    - Schema version & enums:
        SCHEMA_VERSION, GRAM_STAIN_VALUES, STRATEGY_VALUES,
        ASSEMBLY_LEVEL_VALUES, CURATION_STATUS_VALUES, ENUMS
    - Pathogen table:
        COLUMN_META (full field docs), COLUMN_LABELS, PATHOGEN_COLUMNS,
        VISIBLE_COLUMNS (columns shown in the UI)
    - Effector table:
        EFFECTOR_COLUMNS_META, EFFECTOR_COLUMN_LABELS, EFFECTOR_COLUMNS,
        EFFECTOR_VISIBLE_COLUMNS, EFFECTOR_CLASSIFICATION_COLUMNS
    - Host-protein table:
        HOST_PROTEIN_COLUMNS_META, HOST_PROTEIN_COLUMN_LABELS,
        HOST_PROTEIN_COLUMNS, HOST_PROTEIN_VISIBLE_COLUMNS
    - Host-target audit table:
        HOST_TARGET_COLUMNS_META, HOST_TARGET_COLUMN_LABELS,
        HOST_TARGET_COLUMNS, HOST_TARGET_VISIBLE_COLUMNS
    - Reference table:
        REFERENCE_COLUMNS_META, REFERENCE_COLUMN_LABELS,
        REFERENCE_COLUMNS, REFERENCE_VISIBLE_COLUMNS
    - Display helpers:
        CLASSIFICATION_LABELS (raw enum value -> human-readable label)

  Used by:
    - js/utils/dataset.js      (validation + normalization)
    - js/ui/upload.js          (template download uses SCHEMA_VERSION)
    - js/views/database.js     (rendering, headers, CSV export, data dictionary)

  Note: COLUMN_META entries are also rendered as the "Data dictionary" table
  in the UI, so their `description` and `source` fields double as user docs.
*/

// Current schema version for the PathoMap dataset
export const SCHEMA_VERSION = '3.0';

// ---------------------------------------------------------------------------
// Enum value lists (must match the CHECK constraints in data/schema.sql)
// ---------------------------------------------------------------------------

// Valid values for gram stain classification
export const GRAM_STAIN_VALUES = [
  'Gram-positive',
  'Gram-negative',
  'Gram-variable',
  'unknown',
];

// Valid values for intracellular survival strategies
export const STRATEGY_VALUES = [
  'arrest',
  'escape',
  'reroute',
  'modified_compartment',
  'extracellular',
  'unknown',
];

// Valid values for genome assembly completeness levels
export const ASSEMBLY_LEVEL_VALUES = [
  'Complete Genome',
  'Chromosome',
  'Scaffold',
  'Contig',
  'unknown',
];

// Valid values for curation status
export const CURATION_STATUS_VALUES = ['curated', 'needs_review'];

// Host-target audit outcomes and their coarse resolution buckets
export const AUDIT_STATUS_VALUES = [
  'verified_protein',
  'verified_protein_family',
  'verified_complex',
  'ambiguous',
  'non_protein',
  'unresolved',
];

export const RESOLUTION_STATUS_VALUES = [
  'resolved_protein',
  'protein_family',
  'protein_complex',
  'ambiguous',
  'non_protein',
  'unresolved',
];

// Provenance class for a specific interaction-evidence record.
export const INTERACTION_EVIDENCE_CLASS_VALUES = [
  'experimental',
  'predicted',
  'annotation-derived',
  'hypothetical',
];

// ---------------------------------------------------------------------------
// Pathogens table metadata
// ---------------------------------------------------------------------------

// Metadata for all columns in the pathogens table
export const COLUMN_META = [
  {
    key: 'entity_id',
    label: 'Entity ID',
    type: 'string',
    description: 'Stable cross-table identifier in the form PM-PAT-0001.',
    source: 'PathoMap identifier system',
  },
  {
    key: 'pathogen_id',
    label: 'ID',
    type: 'integer',
    description: 'Stable internal identifier (unchanged from the v1 dataset).',
    source: 'PathoMap curation',
  },
  {
    key: 'name',
    label: 'Name',
    type: 'string',
    description: 'Display name, including serovar where relevant.',
    source: 'PathoMap curation',
  },
  {
    key: 'genus',
    label: 'Genus',
    type: 'string',
    description: 'Taxonomic genus.',
    source: 'NCBI Taxonomy',
  },
  {
    key: 'species',
    label: 'Species',
    type: 'string',
    description: 'Binomial species name.',
    source: 'NCBI Taxonomy',
  },
  {
    key: 'serovar',
    label: 'Serovar',
    type: 'string, nullable',
    description: 'Serovar or pathotype when the row is below species level.',
    source: 'PathoMap curation',
  },
  {
    key: 'tax_id',
    label: 'NCBI Tax ID',
    type: 'integer',
    description: 'NCBI Taxonomy identifier.',
    source: 'NCBI Taxonomy',
  },
  {
    key: 'family',
    label: 'Family',
    type: 'string',
    description: 'Taxonomic family.',
    source: 'NCBI Taxonomy',
  },
  {
    key: 'order_name',
    label: 'Order',
    type: 'string',
    description: 'Taxonomic order.',
    source: 'NCBI Taxonomy',
  },
  {
    key: 'class_name',
    label: 'Class',
    type: 'string',
    description: 'Taxonomic class.',
    source: 'NCBI Taxonomy',
  },
  {
    key: 'phylum',
    label: 'Phylum',
    type: 'string',
    description: 'Taxonomic phylum.',
    source: 'NCBI Taxonomy',
  },
  {
    key: 'gram_stain',
    label: 'Gram Stain',
    type: 'enum',
    description: 'Gram reaction. Acid-fast organisms are recorded as Gram-positive with acid_fast=true.',
    source: 'PathoMap curation',
  },
  {
    key: 'acid_fast',
    label: 'Acid-fast',
    type: 'boolean',
    description: 'Whether the organism is acid-fast (for example, Mycobacterium).',
    source: 'PathoMap curation',
  },
  {
    key: 'strategy',
    label: 'Strategy',
    type: 'enum',
    description: 'Intracellular survival strategy used by the pathogen.',
    source: 'PathoMap curation',
  },
  {
    key: 'genome_accession',
    label: 'Genome Accession',
    type: 'string',
    description: 'NCBI assembly accession for the representative genome.',
    source: 'NCBI Datasets',
  },
  {
    key: 'assembly_level',
    label: 'Assembly Level',
    type: 'enum',
    description: 'Completeness of the representative assembly.',
    source: 'NCBI Datasets',
  },
  {
    key: 'genome_size_mb',
    label: 'Genome Size (Mb)',
    type: 'number',
    description: 'Total assembly length in megabases.',
    source: 'NCBI Datasets',
  },
  {
    key: 'gc_content',
    label: 'GC Content (%)',
    type: 'number',
    description: 'GC content of the representative assembly.',
    source: 'NCBI Datasets',
  },
  {
    key: 'n_contigs',
    label: 'Contigs',
    type: 'integer',
    description: 'Number of contigs in the representative assembly.',
    source: 'NCBI Datasets',
  },
  {
    key: 'reference_doi',
    label: 'Reference DOI',
    type: 'string',
    description: 'DOI for the primary curation reference (display convenience).',
    source: 'PathoMap curation',
  },
  {
    key: 'reference_ids',
    label: 'Reference IDs',
    type: 'array',
    description: 'Stable PM-REF identifiers linking this row to the references table.',
    source: 'data/sources/reference_ids.json',
  },
  {
    key: 'description',
    label: 'Description',
    type: 'string',
    description: 'Curated prose summary migrated from v1.',
    source: 'PathoMap curation',
  },
  {
    key: 'curation_status',
    label: 'Curation Status',
    type: 'enum',
    description: 'curated means all required taxonomy and genome fields were resolved; needs_review flags gaps.',
    source: 'PathoMap curation',
  },
  {
    key: 'last_updated',
    label: 'Last Updated',
    type: 'date',
    description: 'Date the row was last rebuilt.',
    source: 'Build script',
  },
];

// Map column keys to their display labels
export const COLUMN_LABELS = Object.fromEntries(
  COLUMN_META.map((column) => [column.key, column.label])
);

// Array of all column keys in order
export const PATHOGEN_COLUMNS = COLUMN_META.map((column) => column.key);

// Columns to display in the main table view
export const VISIBLE_COLUMNS = [
  'entity_id',
  'name',
  'gram_stain',
  'acid_fast',
  'strategy',
  'genome_size_mb',
  'gc_content',
  'reference_doi',
];

// ---------------------------------------------------------------------------
// Effectors table metadata
// ---------------------------------------------------------------------------

// Metadata for all columns in the effectors table
export const EFFECTOR_COLUMNS_META = [
  {
    key: 'entity_id',
    label: 'Entity ID',
    type: 'string',
    description: 'Stable cross-table identifier in the form PM-EFF-0001.',
    source: 'PathoMap identifier system',
  },
  {
    key: 'effector_name',
    label: 'Name',
    type: 'string',
    description: 'Effector protein name.',
    source: 'PathoMap curation',
  },
  {
    key: 'effector_name_class',
    label: 'Effector Name Class',
    type: 'string',
    description: 'Protein family classification of the effector (kinase, phosphatase, protease, GTPase, lipase, phospholipase, deacetylase, acetyltransferase, adenylate_cyclase, metalloprotease, serine_protease, cysteine_protease, glycosyltransferase, methyltransferase, ubiquitin_ligase, deubiquitinase, helicase, nuclease, pore_forming, adhesin, surface_protein, membrane_protein, structural_protein, porin, flagellin, capsule, LPS, lipoprotein, toxin, antigen, effector, enzyme, invasin, secretion_component, virulence_factor, other).',
    source: 'PathoMap curation',
  },
  {
    key: 'pathogen_id',
    label: 'Pathogen ID',
    type: 'integer',
    description: 'Foreign key to pathogens.pathogen_id.',
    source: 'Derived from pathogen_name',
  },
  {
    key: 'pathogen_name',
    label: 'Pathogen',
    type: 'string',
    description: 'Name of the pathogen that produces this effector.',
    source: 'PathoMap curation',
  },
  {
    key: 'host_target_id',
    label: 'Host Target ID',
    type: 'integer',
    description: 'Foreign key to host_targets.host_target_id. The target row carries the audit status and any resolved host_protein_id.',
    source: 'Audited from host_target',
  },
  {
    key: 'host_target',
    label: 'Host Target',
    type: 'string',
    description: 'Host protein or cellular component targeted by the effector.',
    source: 'PathoMap curation',
  },
  {
    key: 'host_target_class',
    label: 'Host Target Class',
    type: 'string',
    description: 'Biological classification of the host target (protein, lipid, organelle, metabolite, nucleic acid, protein family, cellular structure, pathway).',
    source: 'PathoMap curation',
  },
  {
    key: 'type',
    label: 'Type',
    type: 'string',
    description: 'Type of effector (e.g., T3SS, T4SS, toxin, adhesin).',
    source: 'PathoMap curation',
  },
  {
    key: 'type_class',
    label: 'Type Class',
    type: 'string',
    description: 'Biological classification of the effector type (t3ss_effector, t4ss_effector, t6ss_effector, toxin, adhesin, secreted_protein, surface_protein, enzyme).',
    source: 'PathoMap curation',
  },
  {
    key: 'mechanism',
    label: 'Mechanism',
    type: 'string',
    description: 'Mechanism of host-cell manipulation.',
    source: 'PathoMap curation',
  },
  {
    key: 'mechanism_class',
    label: 'Mechanism Class',
    type: 'string',
    description: 'Biological classification of the mechanism (signalling_modulation, cytoskeletal_remodelling, membrane_trafficking, immune_evasion, cell_death_modulation, metabolic_manipulation, transcriptional_regulation, protein_modification, membrane_disruption, intracellular_survival, nutrient_acquisition).',
    source: 'PathoMap curation',
  },
  {
    key: 'uniprot_id',
    label: 'UniProt ID',
    type: 'string, nullable',
    description: 'UniProt accession for the effector protein (curated mapping or search fallback).',
    source: 'UniProt API',
  },
  {
    key: 'sequence',
    label: 'Sequence',
    type: 'string, nullable',
    description: 'Amino acid sequence of the effector.',
    source: 'UniProt API',
  },
  {
    key: 'sequence_length',
    label: 'Length (aa)',
    type: 'integer, nullable',
    description: 'Number of amino acids in the sequence (merged from the derived feature file at load time).',
    source: 'data/derived/effector_features.json',
  },
  {
    key: 'molecular_weight_da',
    label: 'MW (Da)',
    type: 'number, nullable',
    description: 'Molecular weight in Daltons (derived feature).',
    source: 'data/derived/effector_features.json',
  },
  {
    key: 'isoelectric_point',
    label: 'pI',
    type: 'number, nullable',
    description: 'Isoelectric point of the effector (derived feature).',
    source: 'data/derived/effector_features.json',
  },
  {
    key: 'gravy_score',
    label: 'GRAVY',
    type: 'number, nullable',
    description: 'Grand average of hydropathy (derived feature).',
    source: 'data/derived/effector_features.json',
  },
  {
    key: 'feature_status',
    label: 'Feature Status',
    type: 'string, nullable',
    description: 'Derived-feature status: computed, incomplete or missing_sequence.',
    source: 'data/derived/effector_features.json',
  },
  {
    key: 'domains',
    label: 'Domains',
    type: 'array',
    description: 'Protein domain annotations from UniProt/InterPro/Pfam.',
    source: 'UniProt / InterPro API',
  },
  {
    key: 'go_terms',
    label: 'GO Terms',
    type: 'array',
    description: 'Gene Ontology annotations.',
    source: 'UniProt API',
  },
  {
    key: 'signal_peptide',
    label: 'Signal Peptide',
    type: 'object, nullable',
    description: 'Signal peptide position {start, end} when annotated.',
    source: 'UniProt API',
  },
  {
    key: 'transmembrane_regions',
    label: 'Transmembrane Regions',
    type: 'array',
    description: 'Transmembrane helix positions [{start, end}, ...].',
    source: 'UniProt API',
  },
  {
    key: 'reference_ids',
    label: 'Reference IDs',
    type: 'array',
    description: 'Stable PM-REF identifiers for per-effector evidence (empty until curated).',
    source: 'PathoMap identifier system',
  },
];

// Map effector column keys to their display labels
export const EFFECTOR_COLUMN_LABELS = Object.fromEntries(
  EFFECTOR_COLUMNS_META.map((column) => [column.key, column.label])
);

export const EFFECTOR_COLUMNS = EFFECTOR_COLUMNS_META.map((column) => column.key);

export const EFFECTOR_VISIBLE_COLUMNS = [
  'entity_id',
  'effector_name',
  'pathogen_name',
  'host_target',
  'type',
  'mechanism',
];

// Columns that should display classification badges in the UI
export const EFFECTOR_CLASSIFICATION_COLUMNS = [
  'effector_name',
  'host_target',
  'type',
  'mechanism',
];

// ---------------------------------------------------------------------------
// Host proteins table metadata
// ---------------------------------------------------------------------------

// Metadata for all columns in the host_proteins table
export const HOST_PROTEIN_COLUMNS_META = [
  {
    key: 'entity_id',
    label: 'Entity ID',
    type: 'string',
    description: 'Stable cross-table identifier in the form PM-HST-0001.',
    source: 'PathoMap identifier system',
  },
  {
    key: 'host_protein_id',
    label: 'ID',
    type: 'integer',
    description: 'Stable internal identifier for the host protein.',
    source: 'PathoMap curation',
  },
  {
    key: 'protein_name',
    label: 'Protein Name',
    type: 'string',
    description: 'Full protein name.',
    source: 'UniProt / PathoMap curation',
  },
  {
    key: 'gene_name',
    label: 'Gene Name',
    type: 'string',
    description: 'Gene symbol or name.',
    source: 'HGNC / PathoMap curation',
  },
  {
    key: 'uniprot_id',
    label: 'UniProt ID',
    type: 'string',
    description: 'UniProt protein identifier.',
    source: 'UniProt',
  },
  {
    key: 'sequence',
    label: 'Sequence',
    type: 'string, nullable',
    description: 'Amino acid sequence of the protein.',
    source: 'UniProt API',
  },
  {
    key: 'sequence_length',
    label: 'Length (aa)',
    type: 'integer, nullable',
    description: 'Number of amino acids in the sequence.',
    source: 'Calculated from sequence',
  },
  {
    key: 'molecular_weight_da',
    label: 'MW (Da)',
    type: 'number, nullable',
    description: 'Molecular weight in Daltons.',
    source: 'Calculated from sequence',
  },
  {
    key: 'isoelectric_point',
    label: 'pI',
    type: 'number, nullable',
    description: 'Isoelectric point (pI) of the protein.',
    source: 'Calculated from sequence',
  },
  {
    key: 'gravy_score',
    label: 'GRAVY',
    type: 'number, nullable',
    description: 'Grand average of hydropathy (indicates hydrophobicity).',
    source: 'Calculated from sequence',
  },
  {
    key: 'domains',
    label: 'Domains',
    type: 'array',
    description: 'Protein domain annotations from InterPro/Pfam.',
    source: 'UniProt / InterPro API',
  },
  {
    key: 'go_terms',
    label: 'GO Terms',
    type: 'array',
    description: 'Gene Ontology annotations.',
    source: 'UniProt API',
  },
  {
    key: 'localization',
    label: 'Localization',
    type: 'string',
    description: 'Cellular localization (e.g., cytosol, membrane, nucleus, endosome).',
    source: 'PathoMap curation',
  },
  {
    key: 'function',
    label: 'Function',
    type: 'string',
    description: 'Functional description of the protein.',
    source: 'UniProt / PathoMap curation',
  },
  {
    key: 'pathway',
    label: 'Pathway',
    type: 'string, nullable',
    description: 'Pathways the protein participates in.',
    source: 'PathoMap curation',
  },
  {
    key: 'pathways_detailed',
    label: 'Pathways (Detailed)',
    type: 'array',
    description: 'Detailed pathway memberships from UniProt cross-references.',
    source: 'UniProt API',
  },
  {
    key: 'interacting_partners',
    label: 'Interactions',
    type: 'array',
    description: 'Known protein interaction partners with confidence scores.',
    source: 'STRING API',
  },
  {
    key: 'reference_doi',
    label: 'Reference DOI',
    type: 'string, nullable',
    description: 'DOI for primary reference describing the protein.',
    source: 'PathoMap curation',
  },
  {
    key: 'reference_ids',
    label: 'Reference IDs',
    type: 'array',
    description: 'Stable PM-REF identifiers linking this protein to the references table.',
    source: 'PathoMap identifier system',
  },
  {
    key: 'evidence_source',
    label: 'Evidence Source',
    type: 'string, nullable',
    description: 'URL or citation supporting the protein annotation (UniProt entry or DOI).',
    source: 'UniProt / PathoMap curation',
  },
  {
    key: 'last_updated',
    label: 'Last Updated',
    type: 'date',
    description: 'Date the row was last rebuilt.',
    source: 'Build script',
  },
];

// Map host protein column keys to their display labels
export const HOST_PROTEIN_COLUMN_LABELS = Object.fromEntries(
  HOST_PROTEIN_COLUMNS_META.map((column) => [column.key, column.label])
);

export const HOST_PROTEIN_COLUMNS = HOST_PROTEIN_COLUMNS_META.map((column) => column.key);

export const HOST_PROTEIN_VISIBLE_COLUMNS = [
  'entity_id',
  'host_protein_id',
  'protein_name',
  'gene_name',
  'uniprot_id',
  'sequence_length',
  'molecular_weight_da',
  'isoelectric_point',
  'gravy_score',
  'domains',
  'localization',
  'function',
  'pathway',
];

// ---------------------------------------------------------------------------
// Host targets table metadata (audited effector targets)
// ---------------------------------------------------------------------------

export const HOST_TARGET_COLUMNS_META = [
  {
    key: 'entity_id',
    label: 'Entity ID',
    type: 'string',
    description: 'Stable cross-table identifier in the form PM-TGT-0001.',
    source: 'PathoMap identifier system',
  },
  {
    key: 'host_target_id',
    label: 'ID',
    type: 'integer',
    description: 'Stable internal identifier used by effectors.host_target_id.',
    source: 'data/sources/host_target_ids.json',
  },
  {
    key: 'name',
    label: 'Original Target',
    type: 'string',
    description: 'Original host_target annotation exactly as curated on the effector.',
    source: 'PathoMap curation',
  },
  {
    key: 'host_target_class',
    label: 'Original Class',
    type: 'enum',
    description: 'Original target class from the classification mapping.',
    source: 'data/classification-mapping.json',
  },
  {
    key: 'host_protein_id',
    label: 'Host Protein ID',
    type: 'integer, nullable',
    description: 'Foreign key to host_proteins.host_protein_id. Set only when the audit resolves to one verified human protein.',
    source: 'Audit resolution',
  },
  {
    key: 'resolution_status',
    label: 'Resolution',
    type: 'enum',
    description: 'Coarse resolution: resolved_protein, protein_family, protein_complex, ambiguous, non_protein or unresolved.',
    source: 'Audit resolution',
  },
  {
    key: 'audit_status',
    label: 'Audit Status',
    type: 'enum',
    description: 'Detailed audit outcome: verified_protein, verified_protein_family, verified_complex, ambiguous, non_protein or unresolved.',
    source: 'data/sources/host_target_audit.json',
  },
  {
    key: 'resolved_name',
    label: 'Resolved Name',
    type: 'string, nullable',
    description: 'Canonical human protein, family or complex name when resolved.',
    source: 'UniProt / audit',
  },
  {
    key: 'gene_symbol',
    label: 'Gene Symbol',
    type: 'string, nullable',
    description: 'HGNC gene symbol for a single verified protein.',
    source: 'UniProt / HGNC',
  },
  {
    key: 'uniprot_id',
    label: 'UniProt ID',
    type: 'string, nullable',
    description: 'UniProt accession for a single verified protein.',
    source: 'UniProt',
  },
  {
    key: 'aliases',
    label: 'Aliases',
    type: 'array',
    description: 'Alternative protein names, gene aliases or CD antigens.',
    source: 'UniProt / audit',
  },
  {
    key: 'members',
    label: 'Members',
    type: 'array',
    description: 'Member proteins for families, complexes and multi-protein targets.',
    source: 'UniProt / audit',
  },
  {
    key: 'evidence_sources',
    label: 'Evidence Sources',
    type: 'array',
    description: 'URLs or source paths supporting the audit decision.',
    source: 'Audit provenance',
  },
  {
    key: 'audit_notes',
    label: 'Audit Notes',
    type: 'string, nullable',
    description: 'Why the annotation was resolved, left ambiguous, or marked non-protein.',
    source: 'Audit provenance',
  },
];

export const HOST_TARGET_COLUMN_LABELS = Object.fromEntries(
  HOST_TARGET_COLUMNS_META.map((column) => [column.key, column.label])
);

export const HOST_TARGET_COLUMNS = HOST_TARGET_COLUMNS_META.map((column) => column.key);

export const HOST_TARGET_VISIBLE_COLUMNS = [
  'entity_id',
  'host_target_id',
  'name',
  'host_target_class',
  'audit_status',
  'resolution_status',
  'resolved_name',
  'gene_symbol',
  'uniprot_id',
  'host_protein_id',
];

// ---------------------------------------------------------------------------
// References table metadata
// ---------------------------------------------------------------------------

export const REFERENCE_COLUMNS_META = [
  {
    key: 'entity_id',
    label: 'Entity ID',
    type: 'string',
    description: 'Stable cross-table identifier in the form PM-REF-0001.',
    source: 'PathoMap identifier system',
  },
  {
    key: 'doi',
    label: 'DOI',
    type: 'string',
    description: 'Normalized DOI shared by the rows that cite this reference.',
    source: 'PathoMap curation',
  },
  {
    key: 'url',
    label: 'URL',
    type: 'string',
    description: 'Resolvable https://doi.org/ link.',
    source: 'doi.org',
  },
];

export const REFERENCE_COLUMN_LABELS = Object.fromEntries(
  REFERENCE_COLUMNS_META.map((column) => [column.key, column.label])
);

export const REFERENCE_COLUMNS = REFERENCE_COLUMNS_META.map((column) => column.key);

export const REFERENCE_VISIBLE_COLUMNS = ['entity_id', 'doi', 'url'];

// ---------------------------------------------------------------------------
// Interaction and interaction-evidence metadata
// ---------------------------------------------------------------------------

export const INTERACTION_COLUMNS_META = [
  { key: 'interaction_id', label: 'Interaction ID', type: 'string', description: 'Stable relationship identifier in the form PM-INT-0001.', source: 'PathoMap identifier registry' },
  { key: 'effector_id', label: 'Effector ID', type: 'string', description: 'Stable PM-EFF identifier for the pathogen effector.', source: 'effectors.entity_id' },
  { key: 'host_protein_id', label: 'Host Protein ID', type: 'string', description: 'Stable PM-HST identifier for the resolved human host protein.', source: 'host_proteins.entity_id' },
  { key: 'mechanism', label: 'Mechanism', type: 'string, nullable', description: 'Recorded host-manipulation mechanism for this relationship.', source: 'Effector curation' },
  { key: 'interaction_type', label: 'Relationship', type: 'string', description: 'Relationship predicate.', source: 'Interaction build' },
  { key: 'provenance', label: 'Provenance', type: 'string', description: 'How this normalized relationship was created.', source: 'Interaction build' },
];
export const INTERACTION_COLUMN_LABELS = Object.fromEntries(INTERACTION_COLUMNS_META.map((column) => [column.key, column.label]));
export const INTERACTION_COLUMNS = INTERACTION_COLUMNS_META.map((column) => column.key);
export const INTERACTION_VISIBLE_COLUMNS = ['interaction_id', 'effector_id', 'host_protein_id', 'mechanism', 'interaction_type'];

export const INTERACTION_EVIDENCE_COLUMNS_META = [
  { key: 'evidence_id', label: 'Evidence ID', type: 'string', description: 'Stable evidence identifier in the form PM-EVD-0001.', source: 'PathoMap identifier registry' },
  { key: 'interaction_id', label: 'Interaction ID', type: 'string', description: 'Foreign key to the normalized interaction relationship.', source: 'interactions.interaction_id' },
  { key: 'evidence_class', label: 'Evidence Class', type: 'enum', description: 'experimental, predicted, annotation-derived or hypothetical.', source: 'Curation / build' },
  { key: 'doi', label: 'DOI', type: 'string, nullable', description: 'Supporting publication DOI when available.', source: 'Curated evidence' },
  { key: 'pmid', label: 'PMID', type: 'string, nullable', description: 'Supporting PubMed identifier when available.', source: 'Curated evidence' },
  { key: 'database_accession', label: 'Database Accession', type: 'string, nullable', description: 'Supporting database record accession when available.', source: 'Curated evidence' },
  { key: 'provenance', label: 'Provenance', type: 'string', description: 'Source file, database or method supporting this evidence record.', source: 'Curated evidence' },
  { key: 'note', label: 'Note', type: 'string, nullable', description: 'Interpretive note or limitation.', source: 'Curated evidence' },
];
export const INTERACTION_EVIDENCE_COLUMN_LABELS = Object.fromEntries(INTERACTION_EVIDENCE_COLUMNS_META.map((column) => [column.key, column.label]));
export const INTERACTION_EVIDENCE_COLUMNS = INTERACTION_EVIDENCE_COLUMNS_META.map((column) => column.key);
export const INTERACTION_EVIDENCE_VISIBLE_COLUMNS = ['evidence_id', 'interaction_id', 'evidence_class', 'doi', 'pmid', 'database_accession'];

// ---------------------------------------------------------------------------
// Enum registry + human-readable classification labels
// ---------------------------------------------------------------------------

// Enum values keyed by their column names
export const ENUMS = {
  gram_stain: GRAM_STAIN_VALUES,
  strategy: STRATEGY_VALUES,
  assembly_level: ASSEMBLY_LEVEL_VALUES,
  curation_status: CURATION_STATUS_VALUES,
  audit_status: AUDIT_STATUS_VALUES,
  resolution_status: RESOLUTION_STATUS_VALUES,
  interaction_evidence_class: INTERACTION_EVIDENCE_CLASS_VALUES,
};

// Classification labels for display
export const CLASSIFICATION_LABELS = {
  // Effector Name classifications (protein families)
  kinase: 'Kinase',
  phosphatase: 'Phosphatase',
  protease: 'Protease',
  GTPase: 'GTPase',
  lipase: 'Lipase',
  phospholipase: 'Phospholipase',
  deacetylase: 'Deacetylase',
  acetyltransferase: 'Acetyltransferase',
  adenylate_cyclase: 'Adenylate cyclase',
  metalloprotease: 'Metalloprotease',
  serine_protease: 'Serine protease',
  cysteine_protease: 'Cysteine protease',
  glycosyltransferase: 'Glycosyltransferase',
  methyltransferase: 'Methyltransferase',
  ubiquitin_ligase: 'Ubiquitin ligase',
  deubiquitinase: 'Deubiquitinase',
  helicase: 'Helicase',
  nuclease: 'Nuclease',
  pore_forming: 'Pore-forming',
  adhesin: 'Adhesin',
  surface_protein: 'Surface protein',
  membrane_protein: 'Membrane protein',
  structural_protein: 'Structural protein',
  porin: 'Porin',
  flagellin: 'Flagellin',
  capsule: 'Capsule',
  LPS: 'LPS',
  lipoprotein: 'Lipoprotein',
  toxin: 'Toxin',
  antigen: 'Antigen',
  effector: 'Effector',
  enzyme: 'Enzyme',
  invasin: 'Invasin',
  secretion_component: 'Secretion component',
  virulence_factor: 'Virulence factor',
  other: 'Other',

  // Host Target classifications
  protein: 'Protein',
  protein_complex: 'Protein complex',
  lipid: 'Lipid',
  organelle: 'Organelle',
  metabolite: 'Metabolite',
  nucleic_acid: 'Nucleic acid',
  protein_family: 'Protein family',
  cellular_structure: 'Cellular structure',
  pathway: 'Pathway',

  // Host-target audit and resolution outcomes
  verified_protein: 'Verified protein',
  verified_protein_family: 'Verified family',
  verified_complex: 'Verified complex',
  ambiguous: 'Ambiguous',
  non_protein: 'Non-protein',
  unresolved: 'Unresolved',
  resolved_protein: 'Resolved protein',

  // Type classifications
  t3ss_effector: 'T3SS effector',
  t4ss_effector: 'T4SS effector',
  t6ss_effector: 'T6SS effector',
  toxin: 'Toxin',
  adhesin: 'Adhesin',
  secreted_protein: 'Secreted protein',
  surface_protein: 'Surface protein',
  enzyme: 'Enzyme',

  // Mechanism classifications
  signalling_modulation: 'Signalling modulation',
  cytoskeletal_remodelling: 'Cytoskeletal remodelling',
  membrane_trafficking: 'Membrane trafficking',
  immune_evasion: 'Immune evasion',
  cell_death_modulation: 'Cell death modulation',
  metabolic_manipulation: 'Metabolic manipulation',
  transcriptional_regulation: 'Transcriptional regulation',
  protein_modification: 'Protein modification',
  membrane_disruption: 'Membrane disruption',
  intracellular_survival: 'Intracellular survival',
  nutrient_acquisition: 'Nutrient acquisition',
};

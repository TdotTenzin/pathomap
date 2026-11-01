/*
  schema.js - Central schema definitions for the PathoMap dataset (v2.0).

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
export const SCHEMA_VERSION = '2.0';

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

// ---------------------------------------------------------------------------
// Pathogens table metadata
// ---------------------------------------------------------------------------

// Metadata for all columns in the pathogens table
export const COLUMN_META = [
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
    description: 'DOI for the primary curation reference.',
    source: 'PathoMap curation',
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
    key: 'pathogen_name',
    label: 'Pathogen',
    type: 'string',
    description: 'Name of the pathogen that produces this effector.',
    source: 'PathoMap curation',
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
];

// Map effector column keys to their display labels
export const EFFECTOR_COLUMN_LABELS = Object.fromEntries(
  EFFECTOR_COLUMNS_META.map((column) => [column.key, column.label])
);

export const EFFECTOR_COLUMNS = EFFECTOR_COLUMNS_META.map((column) => column.key);

export const EFFECTOR_VISIBLE_COLUMNS = [
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
    key: 'reference_doi',
    label: 'Reference DOI',
    type: 'string, nullable',
    description: 'DOI for primary reference describing the protein.',
    source: 'PathoMap curation',
  },
  {
    key: 'curation_status',
    label: 'Curation Status',
    type: 'enum',
    description: 'curated means all required fields were resolved; needs_review flags gaps.',
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

// Map host protein column keys to their display labels
export const HOST_PROTEIN_COLUMN_LABELS = Object.fromEntries(
  HOST_PROTEIN_COLUMNS_META.map((column) => [column.key, column.label])
);

export const HOST_PROTEIN_COLUMNS = HOST_PROTEIN_COLUMNS_META.map((column) => column.key);

export const HOST_PROTEIN_VISIBLE_COLUMNS = [
  'protein_name',
  'gene_name',
  'uniprot_id',
  'localization',
  'function',
  'pathway',
];

// ---------------------------------------------------------------------------
// Enum registry + human-readable classification labels
// ---------------------------------------------------------------------------

// Enum values keyed by their column names
export const ENUMS = {
  gram_stain: GRAM_STAIN_VALUES,
  strategy: STRATEGY_VALUES,
  assembly_level: ASSEMBLY_LEVEL_VALUES,
  curation_status: CURATION_STATUS_VALUES,
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

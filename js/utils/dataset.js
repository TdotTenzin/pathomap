/*
  dataset.js - Validation and normalization utilities for PathoMap datasets.

  Purpose: Cleans and validates raw JSON (from the curated file or a user
  upload) into a consistent internal shape before it reaches the UI. Ensures
  every pathogen/effector/host-protein row has the correct types, valid enum
  values, and unique IDs regardless of input quality.

  Exports:
    DATA_SCHEMA_VERSION       Re-export of SCHEMA_VERSION.
    validateDataset(data)     Returns { valid, errors[], warnings[] }.
                              Errors block loading (structural problems);
                              warnings are non-fatal (bad enums, dupes, etc.).
    normalizeDataset(data)    Returns { meta, pathogens[], effectors[],
                              host_proteins[] } with every field coerced to
                              its expected type and unknown values defaulted.

  Private helpers:
    cleanString(v)    Coerce to trimmed string ('' for null/undefined).
    nullableString(v) Same but returns null instead of '' when empty.
    asNumber(v)       Parse float; null if not finite / empty.
    asInteger(v)      Parse integer; null if not a whole number.
    asBoolean(v)      Truthy coercion accepting true/1/'yes'/'y' strings.
    inferGenus(name)  Fallback: first word of the organism name.

  Normalization guarantees:
    - pathogen_id / host_protein_id are unique positive integers (auto-assigned
      when missing, non-positive, or duplicated).
    - Enum fields (gram_stain, strategy, assembly_level, curation_status) fall
      back to 'unknown' / 'needs_review' when the value isn't in the allowed set.
    - Output rows contain ONLY the columns declared in schema.js (extras dropped).
    - meta.tables always reflects the post-normalization row counts.

  Used by: js/data/loader.js (setDataset/loadDataset) and js/ui/upload.js
  (validateDataset before accepting an upload).
*/

import {
  ASSEMBLY_LEVEL_VALUES,
  CURATION_STATUS_VALUES,
  ENUMS,
  GRAM_STAIN_VALUES,
  PATHOGEN_COLUMNS,
  SCHEMA_VERSION,
  STRATEGY_VALUES,
  EFFECTOR_COLUMNS,
  HOST_PROTEIN_COLUMNS,
} from '../data/schema.js';

export const DATA_SCHEMA_VERSION = SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// Type-coercion helpers (private)
// ---------------------------------------------------------------------------

// Convert a value to a trimmed string, defaulting to empty string
function cleanString(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// Convert a value to a trimmed string or null if empty (for nullable columns)
function nullableString(value) {
  const text = cleanString(value);
  return text || null;
}

// Convert a value to a number or null if invalid/empty
function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Convert a value to an integer or null if it's not a whole number
function asInteger(value) {
  const number = asNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

// Convert a value to a boolean (accepts true/false, 0/1, 'yes'/'no', 'y'/'n')
function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = cleanString(value).toLowerCase();
  return ['true', 'yes', '1', 'y'].includes(text);
}

// Keep a value only when it is an array (used for domains, GO terms, etc.)
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Keep a value only when it is a plain object (e.g. signal_peptide), else null
function asObjectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

// Shared enrichment fields added by the API build pipeline (sequence, molecular
// features, domains, GO terms). Arrays default to [], scalars to null.
function normalizeEnrichment(row) {
  return {
    sequence: nullableString(row.sequence),
    sequence_length: asInteger(row.sequence_length),
    molecular_weight_da: asNumber(row.molecular_weight_da),
    isoelectric_point: asNumber(row.isoelectric_point),
    gravy_score: asNumber(row.gravy_score),
    domains: asArray(row.domains),
    go_terms: asArray(row.go_terms),
  };
}

// Infer genus from a pathogen name (first word) when the genus field is empty
function inferGenus(name) {
  return name.split(/\s+/).filter(Boolean)[0] || '';
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Validate a dataset structure and return errors (fatal) + warnings (advisory)
export function validateDataset(data) {
  const errors = [];
  const warnings = [];

  // Check basic structure: must be a non-array object with a pathogens array
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['Dataset must be a JSON object.'], warnings };
  }
  if (!Array.isArray(data.pathogens)) {
    return {
      valid: false,
      errors: ['Missing required array: pathogens.'],
      warnings,
    };
  }
  if (data.pathogens.length === 0) {
    warnings.push('The pathogens array is empty.');
  }

  // Warn about unrecognized top-level arrays (ignored by the app)
  const extraTables = Object.keys(data).filter(
    (key) => !['meta', 'pathogens', 'effectors', 'host_proteins'].includes(key) && Array.isArray(data[key])
  );
  if (extraTables.length) {
    warnings.push(
      `Only the pathogens, effectors, and host_proteins tables are used in this build; ignored: ${extraTables.join(', ')}.`
    );
  }

  // Track duplicates across rows for name and id uniqueness checks
  const seenNames = new Set();
  const seenIds = new Set();

  // Validate each pathogen row (structural errors vs advisory warnings)
  data.pathogens.forEach((row, index) => {
    const label = `Row ${index + 1}`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${label}: expected an object.`);
      return;
    }
    const name = cleanString(row.name);
    if (!name) {
      errors.push(`${label}: name is required.`);
    } else if (seenNames.has(name.toLowerCase())) {
      warnings.push(`${label}: duplicate pathogen name "${name}".`);
    } else {
      seenNames.add(name.toLowerCase());
    }

    // Duplicate IDs are warned (not errored) — normalizeDataset will reassign
    const id = asInteger(row.pathogen_id);
    if (id !== null) {
      if (seenIds.has(id)) warnings.push(`${label}: duplicate pathogen_id ${id}.`);
      seenIds.add(id);
    }

    // Validate enum values (unknown values are warnings; normalize defaults them)
    if (row.gram_stain !== undefined && !GRAM_STAIN_VALUES.includes(row.gram_stain)) {
      warnings.push(`${label}: unknown gram_stain "${row.gram_stain}".`);
    }
    if (row.strategy !== undefined && !STRATEGY_VALUES.includes(row.strategy)) {
      warnings.push(`${label}: unknown strategy "${row.strategy}".`);
    }
    if (row.assembly_level !== undefined && !ASSEMBLY_LEVEL_VALUES.includes(row.assembly_level)) {
      warnings.push(`${label}: unknown assembly_level "${row.assembly_level}".`);
    }
    if (
      row.curation_status !== undefined &&
      !CURATION_STATUS_VALUES.includes(row.curation_status)
    ) {
      warnings.push(`${label}: unknown curation_status "${row.curation_status}".`);
    }

    // Validate numeric fields (must parse to a finite number when present)
    ['genome_size_mb', 'gc_content', 'n_contigs', 'tax_id'].forEach((key) => {
      if (row[key] !== undefined && row[key] !== null && row[key] !== '' && asNumber(row[key]) === null) {
        warnings.push(`${label}: ${key} is not numeric.`);
      }
    });

    // DOIs should start with "10." per the DOI standard
    if (row.reference_doi && !cleanString(row.reference_doi).startsWith('10.')) {
      warnings.push(`${label}: reference_doi does not look like a DOI.`);
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

// Normalize a dataset: coerce types, dedupe IDs, apply enum fallbacks, and
// restrict output to the columns declared in schema.js
export function normalizeDataset(data) {
  const sourceRows = Array.isArray(data?.pathogens) ? data.pathogens : [];
  const usedIds = new Set();
  let nextId = 1;

  const pathogens = sourceRows
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => {
      const name = cleanString(row.name);
      const genus = cleanString(row.genus) || inferGenus(name);
      const species = cleanString(row.species) || name;
      let pathogenId = asInteger(row.pathogen_id);
      // Assign a fresh ID if missing, non-positive, or already used
      if (
        pathogenId === null ||
        pathogenId <= 0 ||
        usedIds.has(pathogenId)
      ) {
        while (usedIds.has(nextId)) nextId += 1;
        pathogenId = nextId;
      }
      usedIds.add(pathogenId);
      nextId = Math.max(nextId, pathogenId + 1);

      // Normalize all fields: enums fall back to defaults, numbers to null
      const normalized = {
        pathogen_id: pathogenId,
        name,
        genus,
        species,
        serovar: nullableString(row.serovar),
        tax_id: asInteger(row.tax_id),
        family: cleanString(row.family),
        order_name: cleanString(row.order_name),
        class_name: cleanString(row.class_name),
        phylum: cleanString(row.phylum),
        gram_stain: GRAM_STAIN_VALUES.includes(row.gram_stain) ? row.gram_stain : 'unknown',
        acid_fast: asBoolean(row.acid_fast),
        strategy: STRATEGY_VALUES.includes(row.strategy) ? row.strategy : 'unknown',
        genome_accession: nullableString(row.genome_accession),
        assembly_level: ASSEMBLY_LEVEL_VALUES.includes(row.assembly_level)
          ? row.assembly_level
          : 'unknown',
        genome_size_mb: asNumber(row.genome_size_mb),
        gc_content: asNumber(row.gc_content),
        n_contigs: asInteger(row.n_contigs),
        reference_doi: cleanString(row.reference_doi),
        description: cleanString(row.description),
        curation_status: CURATION_STATUS_VALUES.includes(row.curation_status)
          ? row.curation_status
          : 'needs_review',
        last_updated: cleanString(row.last_updated),
      };

      // Keep only declared columns (drops unknown/extra keys from input)
      return Object.fromEntries(PATHOGEN_COLUMNS.map((key) => [key, normalized[key]]));
    });

  // Normalize effectors (string-only columns; no ID or enum handling needed)
  const sourceEffectors = Array.isArray(data?.effectors) ? data.effectors : [];
  const effectors = sourceEffectors
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => {
      const normalized = {
        effector_name: cleanString(row.effector_name),
        effector_name_class: cleanString(row.effector_name_class),
        pathogen_name: cleanString(row.pathogen_name),
        host_target: cleanString(row.host_target),
        host_target_class: cleanString(row.host_target_class),
        type: cleanString(row.type),
        type_class: cleanString(row.type_class),
        mechanism: cleanString(row.mechanism),
        mechanism_class: cleanString(row.mechanism_class),
        uniprot_id: nullableString(row.uniprot_id),
        ...normalizeEnrichment(row),
        signal_peptide: asObjectOrNull(row.signal_peptide),
        transmembrane_regions: asArray(row.transmembrane_regions),
      };

      // Keep only declared columns
      return Object.fromEntries(EFFECTOR_COLUMNS.map((key) => [key, normalized[key]]));
    });

  // Normalize host_proteins (same ID-dedup pattern as pathogens)
  const sourceHostProteins = Array.isArray(data?.host_proteins) ? data.host_proteins : [];
  const usedHostProteinIds = new Set();
  let nextHostProteinId = 1;
  const host_proteins = sourceHostProteins
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => {
      let hostProteinId = asInteger(row.host_protein_id);
      // Assign a fresh ID if missing, non-positive, or already used
      if (
        hostProteinId === null ||
        hostProteinId <= 0 ||
        usedHostProteinIds.has(hostProteinId)
      ) {
        while (usedHostProteinIds.has(nextHostProteinId)) nextHostProteinId += 1;
        hostProteinId = nextHostProteinId;
      }
      usedHostProteinIds.add(hostProteinId);
      nextHostProteinId = Math.max(nextHostProteinId, hostProteinId + 1);

      const normalized = {
        host_protein_id: hostProteinId,
        protein_name: cleanString(row.protein_name),
        gene_name: cleanString(row.gene_name),
        uniprot_id: cleanString(row.uniprot_id),
        ...normalizeEnrichment(row),
        localization: cleanString(row.localization),
        function: cleanString(row.function),
        pathway: nullableString(row.pathway),
        pathways_detailed: asArray(row.pathways_detailed),
        interacting_partners: asArray(row.interacting_partners),
        reference_doi: nullableString(row.reference_doi),
        curation_status: CURATION_STATUS_VALUES.includes(row.curation_status)
          ? row.curation_status
          : 'needs_review',
        last_updated: cleanString(row.last_updated),
      };

      // Keep only declared columns
      return Object.fromEntries(HOST_PROTEIN_COLUMNS.map((key) => [key, normalized[key]]));
    });

  // Merge caller meta with our own fields; tables[] always reflects final counts
  const meta = {
    dataset: 'pathomap',
    schema_version: SCHEMA_VERSION,
    ...(data?.meta && typeof data.meta === 'object' ? data.meta : {}),
    tables: { pathogens: pathogens.length, effectors: effectors.length, host_proteins: host_proteins.length },
  };

  return { meta, pathogens, effectors, host_proteins };
}

// Re-export column lists and enums for convenience (avoids deep imports)
export { PATHOGEN_COLUMNS, EFFECTOR_COLUMNS, HOST_PROTEIN_COLUMNS, ENUMS };

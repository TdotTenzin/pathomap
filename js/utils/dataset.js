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

// Convert a value to a trimmed string, defaulting to empty string
function cleanString(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// Convert a value to a trimmed string or null if empty
function nullableString(value) {
  const text = cleanString(value);
  return text || null;
}

// Convert a value to a number or null if invalid
function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Convert a value to an integer or null if invalid
function asInteger(value) {
  const number = asNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

// Convert a value to a boolean
function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = cleanString(value).toLowerCase();
  return ['true', 'yes', '1', 'y'].includes(text);
}

// Infer genus from a pathogen name (first word)
function inferGenus(name) {
  return name.split(/\s+/).filter(Boolean)[0] || '';
}

// Validate a dataset structure and return errors/warnings
export function validateDataset(data) {
  const errors = [];
  const warnings = [];

  // Check basic structure
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

  // Warn about extra tables
  const extraTables = Object.keys(data).filter(
    (key) => !['meta', 'pathogens', 'effectors', 'host_proteins'].includes(key) && Array.isArray(data[key])
  );
  if (extraTables.length) {
    warnings.push(
      `Only the pathogens, effectors, and host_proteins tables are used in this build; ignored: ${extraTables.join(', ')}.`
    );
  }

  // Track duplicates
  const seenNames = new Set();
  const seenIds = new Set();

  // Validate each pathogen row
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

    const id = asInteger(row.pathogen_id);
    if (id !== null) {
      if (seenIds.has(id)) warnings.push(`${label}: duplicate pathogen_id ${id}.`);
      seenIds.add(id);
    }

    // Validate enum values
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

    // Validate numeric fields
    ['genome_size_mb', 'gc_content', 'n_contigs', 'tax_id'].forEach((key) => {
      if (row[key] !== undefined && row[key] !== null && row[key] !== '' && asNumber(row[key]) === null) {
        warnings.push(`${label}: ${key} is not numeric.`);
      }
    });

    // Validate DOI format
    if (row.reference_doi && !cleanString(row.reference_doi).startsWith('10.')) {
      warnings.push(`${label}: reference_doi does not look like a DOI.`);
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

// Normalize a dataset by cleaning, validating, and restructuring pathogen data
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
      // Assign new ID if missing, invalid, or duplicate
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

      // Normalize all fields to expected types
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

      // Ensure only defined columns are included
      return Object.fromEntries(PATHOGEN_COLUMNS.map((key) => [key, normalized[key]]));
    });

  // Normalize effectors
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
      };

      // Ensure only defined columns are included
      return Object.fromEntries(EFFECTOR_COLUMNS.map((key) => [key, normalized[key]]));
    });

  // Normalize host_proteins
  const sourceHostProteins = Array.isArray(data?.host_proteins) ? data.host_proteins : [];
  const usedHostProteinIds = new Set();
  let nextHostProteinId = 1;
  const host_proteins = sourceHostProteins
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => {
      let hostProteinId = asInteger(row.host_protein_id);
      // Assign new ID if missing, invalid, or duplicate
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
        localization: cleanString(row.localization),
        function: cleanString(row.function),
        pathway: nullableString(row.pathway),
        reference_doi: nullableString(row.reference_doi),
        curation_status: CURATION_STATUS_VALUES.includes(row.curation_status)
          ? row.curation_status
          : 'needs_review',
        last_updated: cleanString(row.last_updated),
      };

      // Ensure only defined columns are included
      return Object.fromEntries(HOST_PROTEIN_COLUMNS.map((key) => [key, normalized[key]]));
    });

  // Build metadata object
  const meta = {
    dataset: 'pathomap',
    schema_version: SCHEMA_VERSION,
    ...(data?.meta && typeof data.meta === 'object' ? data.meta : {}),
    tables: { pathogens: pathogens.length, effectors: effectors.length, host_proteins: host_proteins.length },
  };

  return { meta, pathogens, effectors, host_proteins };
}

export { PATHOGEN_COLUMNS, EFFECTOR_COLUMNS, HOST_PROTEIN_COLUMNS, ENUMS };

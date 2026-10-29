import {
  ASSEMBLY_LEVEL_VALUES,
  CURATION_STATUS_VALUES,
  ENUMS,
  GRAM_STAIN_VALUES,
  PATHOGEN_COLUMNS,
  SCHEMA_VERSION,
  STRATEGY_VALUES,
} from '../data/schema.js';

export const DATA_SCHEMA_VERSION = SCHEMA_VERSION;

function cleanString(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function nullableString(value) {
  const text = cleanString(value);
  return text || null;
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asInteger(value) {
  const number = asNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = cleanString(value).toLowerCase();
  return ['true', 'yes', '1', 'y'].includes(text);
}

function inferGenus(name) {
  return name.split(/\s+/).filter(Boolean)[0] || '';
}

export function validateDataset(data) {
  const errors = [];
  const warnings = [];

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

  const extraTables = Object.keys(data).filter(
    (key) => !['meta', 'pathogens'].includes(key) && Array.isArray(data[key])
  );
  if (extraTables.length) {
    warnings.push(
      `Only the pathogens table is used in this build; ignored: ${extraTables.join(', ')}.`
    );
  }

  const seenNames = new Set();
  const seenIds = new Set();

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

    ['genome_size_mb', 'gc_content', 'n_contigs', 'tax_id'].forEach((key) => {
      if (row[key] !== undefined && row[key] !== null && row[key] !== '' && asNumber(row[key]) === null) {
        warnings.push(`${label}: ${key} is not numeric.`);
      }
    });

    if (row.reference_doi && !cleanString(row.reference_doi).startsWith('10.')) {
      warnings.push(`${label}: reference_doi does not look like a DOI.`);
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

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

      return Object.fromEntries(PATHOGEN_COLUMNS.map((key) => [key, normalized[key]]));
    });

  const meta = {
    dataset: 'pathomap',
    schema_version: SCHEMA_VERSION,
    ...(data?.meta && typeof data.meta === 'object' ? data.meta : {}),
    tables: { pathogens: pathogens.length },
  };

  return { meta, pathogens };
}

export { PATHOGEN_COLUMNS, ENUMS };

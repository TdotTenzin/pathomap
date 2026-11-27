/*
  ingest.js - Turn a pasted/uploaded table into a small canonical dataset.

  Accepts delimited text (CSV/TSV/semicolon) or a JSON object containing any of
  the known dataset tables. Column detection uses plain-language aliases so a
  scientist does not need to know the internal schema.
*/

import { parseRecords } from '../experiment/csv.js';
import { calculateFeatures } from '../experiment/features.js';
import { normalizeKey, splitList, unique } from './utils.js';

export const FIELD_ALIASES = {
  pathogen: ['pathogen', 'pathogen_name', 'organism', 'species', 'bacteria', 'strain'],
  effector: ['effector', 'effector_name', 'protein', 'protein_name', 'name', 'id', 'effector_id'],
  sequence: ['sequence', 'seq', 'aa_sequence', 'amino_acid_sequence', 'protein_sequence'],
  host: ['host_protein', 'host_protein_name', 'protein_target', 'target', 'host_target', 'host', 'target_protein'],
  hostId: ['host_protein_id', 'uniprot', 'uniprot_id', 'accession', 'protein_id'],
  phenotype: ['phenotype', 'survival_strategy', 'strategy', 'label', 'class', 'outcome', 'group'],
  value: ['value', 'measurement', 'assay_value', 'result', 'readout', 'numeric_value'],
  assay: ['assay', 'assay_name', 'measurement_type', 'metric'],
  evidenceClass: ['evidence_class', 'evidence', 'evidence_type'],
  doi: ['doi', 'reference_doi', 'citation'],
  pmid: ['pmid', 'pubmed_id'],
  note: ['note', 'notes', 'comment', 'comments'],
  mechanism: ['mechanism'],
  pathway: ['pathway', 'pathways', 'go_term', 'process', 'host_process'],
  gramStain: ['gram_stain', 'gram'],
  molecularWeight: ['molecular_weight_da', 'molecular_weight', 'mw'],
  isoelectricPoint: ['isoelectric_point', 'pi'],
  gravy: ['gravy_score', 'gravy'],
};

export const FIELD_LABELS = {
  pathogen: 'Pathogen',
  effector: 'Effector',
  sequence: 'Sequence',
  host: 'Host protein / target',
  hostId: 'Host protein ID / UniProt',
  phenotype: 'Phenotype / strategy',
  value: 'Measurement value',
  assay: 'Assay',
  evidenceClass: 'Evidence class',
  doi: 'DOI / citation',
  pmid: 'PMID',
  note: 'Note',
  mechanism: 'Mechanism',
  pathway: 'Pathway / process',
  gramStain: 'Gram stain',
  molecularWeight: 'Molecular weight',
  isoelectricPoint: 'Isoelectric point',
  gravy: 'GRAVY',
};

export function detectMapping(headers) {
  const mapping = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    mapping[field] = aliases.find((alias) => headers.includes(alias)) || null;
  }
  return mapping;
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function emptyDataset() {
  return {
    meta: {
      schema_version: 'upload-1',
      source: 'experiment-upload',
      built_at: new Date().toISOString(),
    },
    pathogens: [],
    references: [],
    effectors: [],
    host_proteins: [],
    host_targets: [],
    interactions: [],
    interaction_evidence: [],
    measurements: [],
  };
}

function buildFromRows(rows, mapping, warnings) {
  const dataset = emptyDataset();
  const pathogenByKey = new Map();
  const effectorByKey = new Map();
  const hostByKey = new Map();
  const targetByKey = new Map();
  const referenceByDoi = new Map();
  const counters = {
    pathogen: 0, effector: 0, host: 0, target: 0,
    interaction: 0, evidence: 0, reference: 0, measurement: 0,
  };

  const nextId = (prefix, kind) => {
    counters[kind] += 1;
    return `U-${prefix}-${String(counters[kind]).padStart(4, '0')}`;
  };

  rows.forEach((row, index) => {
    const cell = (field) => (mapping[field] ? String(row[mapping[field]] ?? '').trim() : '');
    const pathogenName = cell('pathogen');
    const effectorName = cell('effector');
    const hostName = cell('host');
    const hostId = cell('hostId');
    const phenotype = cell('phenotype');
    const value = numeric(cell('value'));
    const doi = cell('doi').toLowerCase();
    const pmid = cell('pmid');
    const note = cell('note');
    const evidenceClass = cell('evidenceClass');

    if (!pathogenName && !effectorName && !hostName && !value && !doi) return;

    let pathogen = null;
    if (pathogenName) {
      const key = normalizeKey(pathogenName);
      pathogen = pathogenByKey.get(key);
      if (!pathogen) {
        pathogen = {
          entity_id: nextId('PAT', 'pathogen'),
          pathogen_id: counters.pathogen,
          name: pathogenName,
          gram_stain: cell('gramStain') || null,
          strategy: effectorName ? null : phenotype || null,
          reference_ids: [],
        };
        pathogenByKey.set(key, pathogen);
        dataset.pathogens.push(pathogen);
      }
    }

    let host = null;
    let target = null;
    if (hostName || hostId) {
      const key = normalizeKey(hostId || hostName);
      host = hostByKey.get(key);
      if (!host) {
        host = {
          entity_id: nextId('HST', 'host'),
          host_protein_id: counters.host,
          protein_name: hostName || hostId,
          gene_name: hostName || null,
          uniprot_id: hostId || null,
          pathways: splitList(cell('pathway')),
          reference_ids: [],
        };
        hostByKey.set(key, host);
        dataset.host_proteins.push(host);
      } else if (cell('pathway')) {
        host.pathways = unique([...(host.pathways || []), ...splitList(cell('pathway'))]);
      }

      const targetKey = normalizeKey(hostName || hostId);
      target = targetByKey.get(targetKey);
      if (!target) {
        target = {
          entity_id: nextId('TGT', 'target'),
          host_target_id: counters.target,
          target_name: hostName || hostId,
          resolution_status: host ? 'resolved' : 'unresolved',
          host_protein_id: host?.host_protein_id ?? null,
          evidence_sources: [],
        };
        targetByKey.set(targetKey, target);
        dataset.host_targets.push(target);
      }
    }

    let effector = null;
    if (effectorName) {
      const key = `${pathogenName ? normalizeKey(pathogenName) : ''}|${normalizeKey(effectorName)}`;
      effector = effectorByKey.get(key);
      if (!effector) {
        const sequence = cell('sequence');
        const computed = calculateFeatures(sequence);
        effector = {
          entity_id: nextId('EFF', 'effector'),
          effector_name: effectorName,
          pathogen_id: pathogen?.pathogen_id ?? null,
          pathogen_name: pathogenName || null,
          sequence,
          sequence_length: computed.sequence_length,
          molecular_weight_da: numeric(cell('molecularWeight')) ?? computed.molecular_weight_da,
          isoelectric_point: numeric(cell('isoelectricPoint')) ?? computed.isoelectric_point,
          gravy_score: numeric(cell('gravy')) ?? computed.gravy_score,
          phenotype: phenotype || null,
          host_target_id: target?.host_target_id ?? null,
          reference_ids: [],
        };
        effectorByKey.set(key, effector);
        dataset.effectors.push(effector);
      } else if (!effector.sequence && cell('sequence')) {
        effector.sequence = cell('sequence');
        Object.assign(effector, calculateFeatures(effector.sequence));
      }
    }

    let interaction = null;
    if (effector && host) {
      const interactionKey = `${effector.entity_id}|${host.entity_id}`;
      interaction = dataset.interactions.find((item) => `${item.effector_id}|${item.host_protein_id}` === interactionKey);
      if (!interaction) {
        interaction = {
          interaction_id: nextId('INT', 'interaction'),
          effector_id: effector.entity_id,
          host_protein_id: host.entity_id,
          interaction_type: 'effector_targets_host_protein',
          mechanism: cell('mechanism') || null,
          provenance: `Uploaded row ${index + 1}`,
        };
        dataset.interactions.push(interaction);
      } else if (cell('mechanism') && !interaction.mechanism) {
        interaction.mechanism = cell('mechanism');
      }
    }

    if (evidenceClass || doi || pmid || note) {
      dataset.interaction_evidence.push({
        evidence_id: nextId('EVD', 'evidence'),
        interaction_id: interaction?.interaction_id ?? null,
        subject_id: interaction ? null : effector?.entity_id || host?.entity_id || null,
        evidence_class: evidenceClass || null,
        doi: doi || null,
        pmid: pmid || null,
        note: note || null,
        provenance: `Uploaded row ${index + 1}`,
      });
    }

    if (value !== null) {
      dataset.measurements.push({
        measurement_id: nextId('MSR', 'measurement'),
        effector_id: effector?.entity_id ?? null,
        host_protein_id: host?.entity_id ?? null,
        assay: cell('assay') || 'Unspecified assay',
        value,
        phenotype: phenotype || null,
      });
    }

    if (doi) {
      let reference = referenceByDoi.get(doi);
      if (!reference) {
        reference = {
          entity_id: nextId('REF', 'reference'),
          doi,
          pmid: pmid || null,
        };
        referenceByDoi.set(doi, reference);
        dataset.references.push(reference);
      }
      const referenceId = reference.entity_id;
      for (const record of [pathogen, effector, host]) {
        if (record && !record.reference_ids.includes(referenceId)) record.reference_ids.push(referenceId);
      }
    }
  });

  if (dataset.pathogens.length === 0 && dataset.effectors.length === 0 && dataset.host_proteins.length === 0) {
    warnings.push('No recognizable pathogen, effector, or host-protein rows were found.');
  }
  if (dataset.interactions.length === 0) {
    warnings.push('No effector-to-host interactions were detected; interaction and network modules will report insufficient data.');
  }

  return dataset;
}

function normalizeJsonDataset(source) {
  const dataset = emptyDataset();
  const warnings = [];
  const tables = ['pathogens', 'references', 'effectors', 'host_proteins', 'host_targets', 'interactions', 'interaction_evidence', 'measurements'];

  for (const table of tables) {
    const rows = Array.isArray(source[table]) ? source[table] : [];
    dataset[table] = rows.map((row, index) => {
      const copy = { ...row };
      if (!copy.entity_id) copy.entity_id = `U-${table.slice(0, 3).toUpperCase()}-${index + 1}`;
      return copy;
    });
    if (rows.length === 0 && ['pathogens', 'effectors', 'host_proteins'].includes(table)) {
      warnings.push(`JSON table "${table}" is empty.`);
    }
  }

  if (source.meta && typeof source.meta === 'object') {
    dataset.meta = { ...dataset.meta, ...source.meta, source: 'experiment-upload' };
  }

  return { dataset, warnings };
}

export function ingestText(text, mappingOverrides = {}) {
  const source = String(text ?? '').trim();
  if (!source) {
    return { ok: false, errors: ['Paste or upload a table before analyzing.'] };
  }

  if (source.startsWith('{') || source.startsWith('[')) {
    try {
      const parsed = JSON.parse(source);
      const result = normalizeJsonDataset(parsed);
      return {
        ok: true,
        sourceKind: 'json',
        dataset: result.dataset,
        mapping: {},
        headers: [],
        rowCount: Object.values(result.dataset).filter(Array.isArray).reduce((sum, rows) => sum + rows.length, 0),
        warnings: result.warnings,
        errors: [],
      };
    } catch (error) {
      return { ok: false, errors: [`Invalid JSON: ${error.message}`] };
    }
  }

  const parsed = parseRecords(source);
  if (parsed.rows.length === 0) {
    return { ok: false, errors: ['No data rows found. Add a header row plus at least one data row.'] };
  }

  const mapping = { ...detectMapping(parsed.headers), ...mappingOverrides };
  const recognized = Object.values(mapping).filter(Boolean);
  if (recognized.length === 0) {
    return {
      ok: true,
      sourceKind: 'table',
      dataset: emptyDataset(),
      mapping,
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      warnings: ['No recognized column names. Use the column mapping controls to identify your data.'],
      errors: [],
    };
  }

  const warnings = [];
  const dataset = buildFromRows(parsed.rows, mapping, warnings);

  return {
    ok: true,
    sourceKind: 'table',
    dataset,
    mapping,
    headers: parsed.headers,
    rowCount: parsed.rows.length,
    warnings,
    errors: [],
  };
}

export function summarizeUpload(dataset) {
  return [
    { label: 'Rows', value: String(dataset.measurements?.length || dataset.effectors?.length || 0) },
    { label: 'Pathogens', value: String(dataset.pathogens?.length || 0) },
    { label: 'Effectors', value: String(dataset.effectors?.length || 0) },
    { label: 'Host proteins', value: String(dataset.host_proteins?.length || 0) },
    { label: 'Interactions', value: String(dataset.interactions?.length || 0) },
    { label: 'Evidence', value: String(dataset.interaction_evidence?.length || 0) },
  ];
}

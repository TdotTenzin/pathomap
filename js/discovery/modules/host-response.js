/* Module 07 - Host Response Analysis (annotation-based process summaries). */

import { annotationLabels, eligible, unique } from '../utils.js';

function processesFor(protein) {
  return unique([
    ...annotationLabels(protein.pathways),
    ...annotationLabels(protein.pathway),
    ...annotationLabels(protein.pathways_detailed),
    ...annotationLabels(protein.process),
  ]);
}

export default {
  id: 'host-response-analysis',
  number: '07',
  name: 'Host Response Analysis',
  question: 'Which host processes are associated with effector targets, and what evidence links them?',
  description: 'Process summaries, mechanism distributions, and cross-pathogen comparisons.',

  canRun(dataset) {
    const annotated = (dataset?.host_proteins || []).filter((protein) => processesFor(protein).length > 0);
    return eligible(
      annotated.length > 0 && (dataset?.interactions?.length || 0) > 0,
      [
        'Host-process annotations are required.',
        'Interactions are required to link targets to effectors.',
      ]
    );
  },

  run(dataset) {
    const indexBy = (rows, keys) => {
      const index = new Map();
      rows.forEach((row) => {
        keys.forEach((key) => {
          if (row[key] !== undefined && row[key] !== null) index.set(row[key], row);
        });
      });
      return index;
    };
    const proteins = indexBy(dataset.host_proteins || [], ['entity_id', 'host_protein_id']);
    const effectors = indexBy(dataset.effectors || [], ['entity_id', 'effector_id']);
    const pathogens = dataset.pathogens || [];
    const pathogenNameById = indexBy(pathogens, ['entity_id', 'pathogen_id']);
    const pathogenIds = pathogens.map((pathogen) => pathogen.entity_id);
    const evidenceByInteraction = new Map();
    (dataset.interaction_evidence || []).forEach((record) => {
      if (!record.interaction_id) return;
      const list = evidenceByInteraction.get(record.interaction_id) || [];
      list.push(record);
      evidenceByInteraction.set(record.interaction_id, list);
    });

    const processData = new Map();
    (dataset.interactions || []).forEach((interaction) => {
      const protein = proteins.get(interaction.host_protein_id);
      if (!protein) return;
      const effector = effectors.get(interaction.effector_id);
      const pathogenId = effector?.pathogen_id;
      const pathogenName = pathogenNameById.get(pathogenId)?.name || effector?.pathogen_name || '—';
      const evidence = evidenceByInteraction.get(interaction.interaction_id) || [];

      processesFor(protein).forEach((process) => {
        if (!processData.has(process)) {
          processData.set(process, { proteins: new Set(), pathogens: new Set(), mechanisms: new Set(), evidence: new Set() });
        }
        const entry = processData.get(process);
        entry.proteins.add(protein.protein_name || protein.entity_id);
        entry.pathogens.add(pathogenName);
        if (interaction.mechanism) entry.mechanisms.add(interaction.mechanism);
        evidence.forEach((record) => {
          if (record.evidence_class) entry.evidence.add(record.evidence_class);
        });
      });
    });

    const processRows = [...processData.entries()]
      .map(([process, entry]) => ({
        process,
        proteins: entry.proteins.size,
        pathogens: entry.pathogens.size,
        pathogen_names: unique([...entry.pathogens]).join(', '),
        mechanisms: unique([...entry.mechanisms]).join(', ') || '—',
        evidence_classes: unique([...entry.evidence]).join(', ') || '—',
      }))
      .sort((a, b) => b.proteins - a.proteins || b.pathogens - a.pathogens || a.process.localeCompare(b.process));

    const mechanismCounts = new Map();
    (dataset.interactions || []).forEach((interaction) => {
      const key = interaction.mechanism || 'Not specified';
      mechanismCounts.set(key, (mechanismCounts.get(key) || 0) + 1);
    });
    const mechanismRows = [...mechanismCounts.entries()]
      .map(([mechanism, count]) => ({ mechanism, count }))
      .sort((a, b) => b.count - a.count);

    const comparisonRows = processRows.slice(0, 20).map((row) => {
      const entry = { process: row.process };
      pathogenIds.forEach((id) => {
        const name = pathogenNameById.get(id)?.name;
        entry[id] = row.pathogen_names.includes(name) ? 1 : 0;
      });
      return entry;
    });

    return {
      metrics: [
        { label: 'Processes represented', value: String(processRows.length) },
        { label: 'Effector-linked proteins', value: String(new Set((dataset.interactions || []).map((item) => item.host_protein_id)).size) },
        { label: 'Mechanisms recorded', value: String(mechanismRows.filter((row) => row.mechanism !== 'Not specified').length) },
      ],
      findings: processRows.slice(0, 5).map((row) => `${row.process}: ${row.proteins} protein(s) across ${row.pathogens} pathogen(s)`),
      tables: [
        {
          title: 'Affected processes',
          columns: [
            { key: 'process', label: 'Process' },
            { key: 'proteins', label: 'Proteins' },
            { key: 'pathogens', label: 'Pathogens' },
            { key: 'pathogen_names', label: 'Pathogen names' },
            { key: 'mechanisms', label: 'Mechanisms' },
            { key: 'evidence_classes', label: 'Evidence classes' },
          ],
          rows: processRows,
        },
        {
          title: 'Mechanism distribution',
          columns: [
            { key: 'mechanism', label: 'Mechanism' },
            { key: 'count', label: 'Interactions' },
          ],
          rows: mechanismRows,
        },
        {
          title: 'Cross-pathogen process presence',
          columns: [
            { key: 'process', label: 'Process' },
            ...pathogenIds.map((id) => ({ key: id, label: pathogenNameById.get(id) })),
          ],
          rows: comparisonRows,
        },
      ],
      notes: [
        'Process association comes from annotations, not a measured cellular response.',
        'Direction and mechanism are reported only when the upload records them.',
        'Evidence classes are shown beside each process so inference strength stays visible.',
      ],
      warnings: [],
    };
  },

  validate(result) {
    return { valid: Array.isArray(result.tables?.[0]?.rows), issues: [] };
  },
};

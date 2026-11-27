/* Module 01 - Interaction Analysis (interactive pathogen-effector-host network). */

import { buildNetworkModel, filterNetwork } from '../../analysis/network.js';
import { countBy, eligible, percent, requireRows, unique } from '../utils.js';

const TABLE_COLUMNS = {
  interactions: [
    { key: 'effector', label: 'Effector' },
    { key: 'pathogen', label: 'Pathogen' },
    { key: 'host', label: 'Host protein' },
    { key: 'evidence', label: 'Strongest evidence' },
    { key: 'mechanism', label: 'Mechanism' },
  ],
  evidence: [
    { key: 'evidence_class', label: 'Evidence class' },
    { key: 'count', label: 'Records' },
  ],
  sharedHosts: [
    { key: 'host', label: 'Host protein' },
    { key: 'pathogen_count', label: 'Pathogens' },
    { key: 'pathogens', label: 'Pathogen names' },
  ],
};

export default {
  id: 'interaction-analysis',
  number: '01',
  name: 'Interaction Analysis',
  question: 'Which pathogen → effector → host-protein relationships are supported by evidence?',
  description: 'Explore the network, inspect evidence, and export the current view.',

  canRun(dataset) {
    return eligible(
      (dataset?.interactions?.length || 0) > 0
        && (dataset?.effectors?.length || 0) > 0
        && (dataset?.host_proteins?.length || 0) > 0,
      [
        ...requireRows(dataset, 'interactions', 1),
        ...requireRows(dataset, 'effectors', 1),
        ...requireRows(dataset, 'host_proteins', 1),
      ]
    );
  },

  run(dataset) {
    const model = buildNetworkModel(dataset, null);
    const filtered = filterNetwork(model, {});
    const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
    const nodeLabel = (id) => nodesById.get(id)?.label || id || '—';

    const interactionRows = filtered.interactionEdges.map((edge) => ({
      effector: nodeLabel(edge.source),
      pathogen: edge.pathogen_name || nodeLabel(edge.pathogen_id),
      host: nodeLabel(edge.target),
      evidence: edge.strongest_evidence_class || 'unclassified',
      mechanism: edge.mechanism || '—',
    }));

    const evidenceCounts = countBy(
      dataset.interaction_evidence || [],
      (record) => record.evidence_class || 'unclassified'
    );
    const evidenceRows = [...evidenceCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([evidence_class, count]) => ({ evidence_class, count }));

    const pathogensByHost = new Map();
    filtered.interactionEdges.forEach((edge) => {
      if (!edge.pathogen_id) return;
      const list = pathogensByHost.get(edge.target) || [];
      list.push(edge.pathogen_id);
      pathogensByHost.set(edge.target, list);
    });
    const sharedHostRows = [...pathogensByHost.entries()]
      .map(([hostId, pathogenIds]) => {
        const pathogens = unique(pathogenIds.map(nodeLabel));
        return { host: nodeLabel(hostId), pathogen_count: pathogens.length, pathogens: pathogens.join(', ') };
      })
      .filter((row) => row.pathogen_count > 1)
      .sort((a, b) => b.pathogen_count - a.pathogen_count);

    const degree = new Map();
    filtered.interactionEdges.forEach((edge) => {
      for (const id of [edge.source, edge.target, edge.pathogen_id].filter(Boolean)) {
        degree.set(id, (degree.get(id) || 0) + 1);
      }
    });
    const hubs = [...degree.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => `${nodeLabel(id)} (${count} links)`);

    const evidenceCoverage = filtered.interactionEdges.length === 0
      ? null
      : filtered.interactionEdges.filter((edge) => (edge.evidence_count || 0) > 0).length / filtered.interactionEdges.length;
    const unresolved = (dataset.host_targets || []).filter((target) => target.resolution_status !== 'resolved');

    return {
      metrics: [
        { label: 'Network nodes', value: String(model.nodes.length) },
        { label: 'Interactions', value: String(filtered.interactionEdges.length) },
        { label: 'Evidence records', value: String((dataset.interaction_evidence || []).length) },
        { label: 'Evidence coverage', value: percent(evidenceCoverage) },
        { label: 'Shared host proteins', value: String(sharedHostRows.length) },
        { label: 'Unresolved targets', value: String(unresolved.length) },
      ],
      findings: [
        ...hubs.map((hub) => `Most connected: ${hub}`),
        ...sharedHostRows.slice(0, 5).map((row) => `${row.host} is linked to ${row.pathogen_count} pathogens`),
      ],
      tables: [
        { title: 'Interactions', columns: TABLE_COLUMNS.interactions, rows: interactionRows },
        { title: 'Evidence classes', columns: TABLE_COLUMNS.evidence, rows: evidenceRows },
        { title: 'Shared host proteins', columns: TABLE_COLUMNS.sharedHosts, rows: sharedHostRows },
      ],
      notes: [
        'Node position and distance are exploratory only; they do not measure interaction strength.',
        'Pathogen-encodes-effector links are membership links, not effector-host interactions.',
        'Open a node or edge in the network to see its evidence records and identifiers.',
      ],
      warnings: [],
      network: { model, filtered },
    };
  },

  validate(result) {
    const issues = [];
    const model = result.network?.model;
    if (!model) return { valid: false, issues: ['Network model was not produced.'] };

    const nodeIds = new Set(model.nodes.map((node) => node.id));
    model.interactionEdges.forEach((edge) => {
      if (!nodeIds.has(edge.source)) issues.push(`Interaction ${edge.id} has an unknown effector node.`);
      if (!nodeIds.has(edge.target)) issues.push(`Interaction ${edge.id} has an unknown host node.`);
    });

    return { valid: issues.length === 0, issues };
  },
};

/* Module 06 - Comparative Pathogen Analysis (descriptive similarity, no evolutionary claim). */

import { eligible, jaccard, round } from '../utils.js';

function mergeClusters(clusters, similarity) {
  let current = clusters.map((cluster) => [...cluster]);
  const target = Math.min(3, Math.max(1, Math.floor(current.length / 2)));
  while (current.length > target) {
    let best = { score: -Infinity, i: 0, j: 1 };
    for (let i = 0; i < current.length; i += 1) {
      for (let j = i + 1; j < current.length; j += 1) {
        const pairs = [];
        current[i].forEach((a) => current[j].forEach((b) => pairs.push(similarity(a, b))));
        const score = pairs.reduce((sum, value) => sum + value, 0) / pairs.length;
        if (score > best.score) best = { score, i, j };
      }
    }
    const merged = [...current[best.i], ...current[best.j]];
    current = current.filter((_, index) => index !== best.i && index !== best.j);
    current.push(merged);
  }
  return current;
}

export default {
  id: 'comparative-pathogen-analysis',
  number: '06',
  name: 'Comparative Pathogen Analysis',
  question: 'How do pathogens differ by effector repertoire and target set?',
  description: 'Jaccard similarity matrices, shared/unique features, and descriptive clusters.',

  canRun(dataset) {
    return eligible((dataset?.pathogens?.length || 0) >= 2, ['At least two pathogens are required for comparison.']);
  },

  run(dataset) {
    const pathogens = dataset.pathogens || [];
    const effectors = dataset.effectors || [];
    const interactions = dataset.interactions || [];
    const effectorById = new Map(effectors.map((effector) => [effector.entity_id, effector]));

    const effectorsByPathogen = new Map(pathogens.map((pathogen) => [pathogen.entity_id, new Set()]));
    const targetsByPathogen = new Map(pathogens.map((pathogen) => [pathogen.entity_id, new Set()]));

    effectors.forEach((effector) => {
      const pathogenId = effector.pathogen_id;
      const pathogen = pathogens.find((item) => item.pathogen_id === pathogenId || item.entity_id === pathogenId);
      if (!pathogen || !effectorsByPathogen.has(pathogen.entity_id)) return;
      effectorsByPathogen.get(pathogen.entity_id).add(effector.effector_name || effector.entity_id);
    });

    interactions.forEach((interaction) => {
      const effector = effectorById.get(interaction.effector_id);
      const pathogen = pathogens.find((item) => item.pathogen_id === effector?.pathogen_id || item.entity_id === effector?.pathogen_id);
      if (!pathogen || !interaction.host_protein_id) return;
      targetsByPathogen.get(pathogen.entity_id).add(interaction.host_protein_id);
    });

    const ids = pathogens.map((pathogen) => pathogen.entity_id);
    const nameOf = (id) => pathogens.find((pathogen) => pathogen.entity_id === id)?.name || id;
    const effectorSimilarity = (a, b) => jaccard(effectorsByPathogen.get(a) || new Set(), effectorsByPathogen.get(b) || new Set());
    const targetSimilarity = (a, b) => jaccard(targetsByPathogen.get(a) || new Set(), targetsByPathogen.get(b) || new Set());

    const matrixRows = ids.map((rowId) => {
      const row = { pathogen: nameOf(rowId) };
      ids.forEach((columnId) => {
        row[columnId] = round(effectorSimilarity(rowId, columnId), 2);
      });
      return row;
    });
    const matrixColumns = [
      { key: 'pathogen', label: 'Pathogen' },
      ...ids.map((id) => ({ key: id, label: nameOf(id) })),
    ];

    const repertoireRows = ids.map((id) => {
      const own = effectorsByPathogen.get(id) || new Set();
      const others = new Set();
      ids.filter((other) => other !== id).forEach((other) => {
        (effectorsByPathogen.get(other) || new Set()).forEach((value) => others.add(value));
      });
      return {
        pathogen: nameOf(id),
        effectors: own.size,
        shared: [...own].filter((value) => others.has(value)).length,
        unique: [...own].filter((value) => !others.has(value)).length,
        targets: (targetsByPathogen.get(id) || new Set()).size,
      };
    });

    const clusters = mergeClusters(ids.map((id) => [id]), effectorSimilarity);
    const clusterRows = clusters.map((cluster, index) => ({
      cluster: index + 1,
      pathogens: cluster.map(nameOf).join(', '),
      mean_effectors: round(
        cluster.reduce((sum, id) => sum + (effectorsByPathogen.get(id)?.size || 0), 0) / cluster.length,
        1
      ),
    }));

    const mostShared = [...repertoireRows].sort((a, b) => b.shared - a.shared)[0];

    return {
      metrics: [
        { label: 'Pathogens compared', value: String(pathogens.length) },
        { label: 'Effectors compared', value: String(effectors.length) },
        { label: 'Targeted host proteins', value: String(new Set(interactions.map((item) => item.host_protein_id)).size) },
        { label: 'Effector clusters', value: String(clusters.length) },
      ],
      findings: [
        mostShared ? `${mostShared.pathogen} shares the most effectors (${mostShared.shared})` : null,
        ...clusterRows.map((row) => `Cluster ${row.cluster}: ${row.pathogens}`),
      ].filter(Boolean),
      tables: [
        { title: 'Effector similarity (Jaccard)', columns: matrixColumns, rows: matrixRows },
        {
          title: 'Shared and unique repertoire',
          columns: [
            { key: 'pathogen', label: 'Pathogen' },
            { key: 'effectors', label: 'Effectors' },
            { key: 'shared', label: 'Shared' },
            { key: 'unique', label: 'Unique' },
            { key: 'targets', label: 'Host targets' },
          ],
          rows: repertoireRows,
        },
        {
          title: 'Descriptive clusters',
          columns: [
            { key: 'cluster', label: 'Cluster' },
            { key: 'pathogens', label: 'Pathogens' },
            { key: 'mean_effectors', label: 'Mean effectors' },
          ],
          rows: clusterRows,
        },
      ],
      notes: [
        'Similarity does not establish shared evolutionary origin or common mechanism.',
        'Unequal annotation coverage and missing data affect every similarity value.',
        'Target similarity uses uploaded interactions only.',
      ],
      warnings: [],
    };
  },

  validate(result) {
    const rows = result.tables?.[0]?.rows || [];
    const issues = rows
      .flatMap((row) => Object.entries(row).filter(([key, value]) => key !== 'pathogen' && !Number.isFinite(value)).map(([key]) => `Invalid similarity in ${row.pathogen} / ${key}.`));
    return { valid: issues.length === 0, issues };
  },
};

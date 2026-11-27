/* Module 05 - Protein Network Analysis (graph structure, not biological importance). */

import { buildNetworkModel, filterNetwork } from '../../analysis/network.js';
import { eligible, requireRows, round } from '../utils.js';

function undirectedAdjacency(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
  edges.forEach((edge) => {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) return;
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  });
  return adjacency;
}

function components(adjacency) {
  const visited = new Set();
  const result = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const queue = [start];
    visited.add(start);
    const members = [];
    while (queue.length) {
      const node = queue.shift();
      members.push(node);
      for (const neighbour of adjacency.get(node) || []) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
    result.push(members);
  }
  return result.sort((a, b) => b.length - a.length);
}

function centrality(adjacency) {
  const ids = [...adjacency.keys()];
  const betweenness = Object.fromEntries(ids.map((id) => [id, 0]));
  const closeness = Object.fromEntries(ids.map((id) => [id, 0]));

  for (const source of ids) {
    const stack = [];
    const predecessors = new Map(ids.map((id) => [id, []]));
    const sigma = Object.fromEntries(ids.map((id) => [id, 0]));
    const distance = Object.fromEntries(ids.map((id) => [id, -1]));
    sigma[source] = 1;
    distance[source] = 0;
    const queue = [source];

    while (queue.length) {
      const node = queue.shift();
      stack.push(node);
      for (const neighbour of adjacency.get(node) || []) {
        if (distance[neighbour] < 0) {
          distance[neighbour] = distance[node] + 1;
          queue.push(neighbour);
        }
        if (distance[neighbour] === distance[node] + 1) {
          sigma[neighbour] += sigma[node];
          predecessors.get(neighbour).push(node);
        }
      }
    }

    const reachable = ids.filter((id) => distance[id] > 0);
    const totalDistance = reachable.reduce((sum, id) => sum + distance[id], 0);
    if (totalDistance > 0) closeness[source] = (reachable.length) / totalDistance;

    const delta = Object.fromEntries(ids.map((id) => [id, 0]));
    while (stack.length) {
      const node = stack.pop();
      for (const predecessor of predecessors.get(node)) {
        delta[predecessor] += (sigma[predecessor] / sigma[node]) * (1 + delta[node]);
      }
      if (node !== source) betweenness[node] += delta[node];
    }
  }

  const count = ids.length;
  if (count > 2) {
    const scale = (count - 1) * (count - 2);
    ids.forEach((id) => { betweenness[id] /= scale; });
  }

  return { betweenness, closeness };
}

export default {
  id: 'protein-network-analysis',
  number: '05',
  name: 'Protein Network Analysis',
  question: 'What structure do the supported effector-host relationships form?',
  description: 'Degree, centrality, connected components, and graph clusters.',

  canRun(dataset) {
    return eligible((dataset?.interactions?.length || 0) > 0, [...requireRows(dataset, 'interactions', 1)]);
  },

  run(dataset) {
    const model = buildNetworkModel(dataset, null);
    const filtered = filterNetwork(model, {});
    // Annotated non-protein / family / complex targets are shown in the
    // interaction network but are not protein nodes for centrality analysis.
    const nodes = filtered.nodes.filter((node) => node.type !== 'host_target');
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = [
      ...filtered.interactionEdges
        .filter((edge) => edge.kind !== 'target_association' && nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .map((edge) => ({ source: edge.source, target: edge.target })),
      ...(filtered.membershipEdges || [])
        .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .map((edge) => ({ source: edge.source, target: edge.target })),
    ];
    const adjacency = undirectedAdjacency(nodes, edges);
    const comps = components(adjacency);
    const componentOf = new Map();
    comps.forEach((members, index) => members.forEach((id) => componentOf.set(id, index + 1)));
    const centralityValues = centrality(adjacency);

    const labels = new Map(nodes.map((node) => [node.id, node.label]));
    const rows = nodes.map((node) => ({
      node: node.label,
      type: node.type.replace('_', ' '),
      degree: adjacency.get(node.id)?.size || 0,
      betweenness: round(centralityValues.betweenness[node.id], 4),
      closeness: round(centralityValues.closeness[node.id], 4),
      component: componentOf.get(node.id) || 0,
    })).sort((a, b) => b.degree - a.degree || b.betweenness - a.betweenness);

    const componentRows = comps.map((members, index) => ({
      component: index + 1,
      nodes: members.length,
      members: members.map((id) => labels.get(id) || id).slice(0, 20).join(', '),
    }));

    const hubs = rows.slice(0, 5).map((row) => `${row.node} (degree ${row.degree})`);

    return {
      metrics: [
        { label: 'Nodes', value: String(nodes.length) },
        { label: 'Edges', value: String(edges.length) },
        { label: 'Components', value: String(comps.length) },
        { label: 'Largest component', value: String(comps[0]?.length || 0) },
      ],
      findings: [
        ...hubs.map((hub) => `Hub: ${hub}`),
        comps.length > 1 ? `Graph has ${comps.length} disconnected components` : null,
      ].filter(Boolean),
      tables: [
        {
          title: 'Node attributes',
          columns: [
            { key: 'node', label: 'Node' },
            { key: 'type', label: 'Type' },
            { key: 'degree', label: 'Degree' },
            { key: 'betweenness', label: 'Betweenness' },
            { key: 'closeness', label: 'Closeness' },
            { key: 'component', label: 'Component' },
          ],
          rows,
        },
        {
          title: 'Connected components',
          columns: [
            { key: 'component', label: 'Component' },
            { key: 'nodes', label: 'Nodes' },
            { key: 'members', label: 'Members' },
          ],
          rows: componentRows,
        },
      ],
      notes: [
        'Centrality describes graph structure, not biological importance.',
        'Components and clusters depend on upload coverage and edge provenance.',
        'Membership links are included as graph edges but are not effector-host interactions.',
        'Annotated non-protein, family, complex, and ambiguous targets are excluded from protein centrality.',
      ],
      warnings: [],
    };
  },

  validate(result) {
    const issues = [];
    const rows = result.tables?.[0]?.rows || [];
    rows.forEach((row) => {
      if (!Number.isFinite(row.degree) || !Number.isFinite(row.betweenness)) issues.push(`Invalid centrality for ${row.node}.`);
    });
    return { valid: issues.length === 0, issues };
  },
};

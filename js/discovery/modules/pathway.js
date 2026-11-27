/* Module 03 - Pathway Analysis (annotated host pathways represented in the upload). */

import { annotationLabels, eligible, unique } from '../utils.js';

function broadPathwaysFor(protein) {
  return unique([
    ...annotationLabels(protein.pathways),
    ...annotationLabels(protein.pathway),
  ]);
}

function detailedPathwaysFor(protein) {
  return annotationLabels(protein.pathways_detailed);
}

function hasAnnotations(protein) {
  return broadPathwaysFor(protein).length > 0 || detailedPathwaysFor(protein).length > 0;
}

function buildView({ id, label, tableTitle, proteins, labelsFor }) {
  const annotatedRows = proteins
    .map((protein) => ({ protein, pathways: labelsFor(protein) }))
    .filter((entry) => entry.pathways.length > 0);
  const annotatedProteins = new Set(annotatedRows.map((entry) => entry.protein));
  const unmapped = proteins.filter((protein) => !annotatedProteins.has(protein));

  const groups = new Map();
  annotatedRows.forEach(({ protein, pathways }) => {
    pathways.forEach((pathway) => {
      const list = groups.get(pathway) || [];
      list.push(protein);
      groups.set(pathway, list);
    });
  });

  const rows = [...groups.entries()]
    .map(([pathway, members]) => ({
      pathway,
      protein_count: members.length,
      proteins: members.map((protein) => protein.protein_name || protein.entity_id).join(', '),
      accessions: members.map((protein) => protein.uniprot_id || '—').join(', '),
    }))
    .sort((a, b) => b.protein_count - a.protein_count || a.pathway.localeCompare(b.pathway));

  return {
    id,
    label,
    viewLabel: 'Pathway detail level',
    metrics: [
      { label: 'Host proteins', value: String(proteins.length) },
      { label: 'Annotated', value: String(annotatedRows.length) },
      { label: 'Pathways represented', value: String(rows.length) },
      { label: 'Unmapped proteins', value: String(unmapped.length) },
    ],
    findings: rows.slice(0, 5).map((row) => `${row.pathway}: ${row.protein_count} protein(s)`),
    tables: [
      {
        title: tableTitle,
        columns: [
          { key: 'pathway', label: 'Pathway' },
          { key: 'protein_count', label: 'Proteins' },
          { key: 'proteins', label: 'Contributing proteins' },
          { key: 'accessions', label: 'Accessions' },
        ],
        rows,
      },
      {
        title: 'Unmapped proteins',
        columns: [{ key: 'protein', label: 'Protein' }],
        rows: unmapped.map((protein) => ({ protein: protein.protein_name || protein.entity_id })),
      },
    ],
  };
}

export default {
  id: 'pathway-analysis',
  number: '03',
  name: 'Pathway Analysis',
  question: 'Which annotated host pathways are represented among the uploaded host proteins?',
  description: 'Stable-accession pathway mapping with contributing proteins and unmapped records.',

  canRun(dataset) {
    const annotated = (dataset?.host_proteins || []).filter(hasAnnotations);
    return eligible(annotated.length > 0, ['No host-protein pathway annotations were provided.']);
  },

  run(dataset) {
    const proteins = dataset.host_proteins || [];
    const views = [
      buildView({
        id: 'broad',
        label: 'Broad categories',
        tableTitle: 'Broad pathways represented',
        proteins,
        labelsFor: broadPathwaysFor,
      }),
      buildView({
        id: 'detailed',
        label: 'Detailed annotations',
        tableTitle: 'Detailed pathways represented',
        proteins,
        labelsFor: detailedPathwaysFor,
      }),
    ];
    const primary = views[0];

    return {
      metrics: primary.metrics,
      findings: primary.findings,
      tables: primary.tables,
      views,
      notes: [
        'Pathway membership is annotation-based; it does not prove perturbation by an effector.',
        'Broad categories come from curated pathway labels. Detailed annotations use the supplied Reactome/KEGG records.',
        'Enrichment significance is reported separately by Functional Enrichment when a background universe is available.',
      ],
      warnings: [],
    };
  },

  validate(result) {
    return { valid: result.tables?.[0]?.rows !== undefined, issues: [] };
  },
};

import { getDataset } from '../data/loader.js';

const EVIDENCE_CLASS_LABELS = {
  experimental: 'Experimental',
  predicted: 'Predicted',
  'annotation-derived': 'Annotation-derived',
  hypothetical: 'Hypothetical',
};

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function createLink(href, text) {
  if (!href) return document.createTextNode(text || '');

  const link = document.createElement('a');
  link.className = 'db-link';
  link.href = href;
  link.textContent = text || href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function createCell(content, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  if (content instanceof Node) {
    cell.appendChild(content);
  } else {
    cell.textContent = content ?? '';
  }
  return cell;
}

function createEmptyState(message) {
  const empty = document.createElement('p');
  empty.className = 'references-empty';
  empty.textContent = message;
  return empty;
}

function createDetails(title, countLabel) {
  const details = document.createElement('details');
  details.className = 'db-schema references-block';

  const summary = document.createElement('summary');
  summary.append(
    document.createTextNode(title),
    document.createTextNode(' '),
    Object.assign(document.createElement('span'), {
      className: 'references-count',
      textContent: countLabel,
    })
  );
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'db-schema-body';
  details.appendChild(body);

  return { details, body };
}

function createTable(columns, rows, renderRow) {
  const wrap = document.createElement('div');
  wrap.className = 'references-table-wrap';

  const table = document.createElement('table');
  table.className = 'references-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  columns.forEach(({ label, className = '' }) => {
    const th = document.createElement('th');
    if (className) th.className = className;
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    renderRow(row, tr);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);

  return wrap;
}

function renderReferencesTable(references) {
  if (!references.length) {
    return createEmptyState('No references are available for this dataset.');
  }

  return createTable(
    [{ label: 'Reference ID' }, { label: 'DOI' }, { label: 'URL' }],
    references,
    (reference, row) => {
      row.appendChild(createCell(reference.entity_id));
      row.appendChild(createCell(reference.doi));
      row.appendChild(createCell(createLink(reference.url, reference.url || reference.doi)));
    }
  );
}

function evidenceClassLabel(evidenceClass) {
  return EVIDENCE_CLASS_LABELS[evidenceClass] || evidenceClass || 'Unknown';
}

function createEvidenceBadge(evidenceClass) {
  const badge = document.createElement('span');
  badge.className = 'references-evidence-class';
  badge.setAttribute('data-class', evidenceClass || 'unknown');
  badge.textContent = evidenceClassLabel(evidenceClass);
  return badge;
}

function createCitation(evidence) {
  const citation = document.createElement('div');
  citation.className = 'references-citation';
  let hasCitation = false;

  if (evidence.doi) {
    citation.appendChild(createLink(`https://doi.org/${evidence.doi}`, evidence.doi));
    hasCitation = true;
  }

  if (evidence.pmid) {
    if (hasCitation) citation.appendChild(document.createTextNode(' · '));
    citation.appendChild(
      createLink(`https://pubmed.ncbi.nlm.nih.gov/${evidence.pmid}/`, `PMID ${evidence.pmid}`)
    );
    hasCitation = true;
  }

  if (evidence.database_accession) {
    if (hasCitation) citation.appendChild(document.createTextNode(' · '));
    citation.appendChild(document.createTextNode(evidence.database_accession));
    hasCitation = true;
  }

  if (!hasCitation) citation.textContent = 'None';
  return citation;
}

function evidenceSummary(evidence) {
  const counts = new Map();
  evidence.forEach((row) => {
    const key = row.evidence_class || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  if (!counts.size) return 'No evidence records';

  return Array.from(counts.entries())
    .map(([evidenceClass, count]) => `${evidenceClassLabel(evidenceClass)} (${count})`)
    .join(' · ');
}

function renderEvidenceTable(evidence) {
  if (!evidence.length) {
    return createEmptyState('No interaction-evidence records are available for this dataset.');
  }

  return createTable(
    [
      { label: 'Evidence ID' },
      { label: 'Interaction ID' },
      { label: 'Class' },
      { label: 'Citation' },
      { label: 'Provenance', className: 'references-provenance' },
      { label: 'Note', className: 'references-note' },
    ],
    evidence,
    (row, tableRow) => {
      tableRow.appendChild(createCell(row.evidence_id));
      tableRow.appendChild(createCell(row.interaction_id));
      tableRow.appendChild(createCell(createEvidenceBadge(row.evidence_class)));
      tableRow.appendChild(createCell(createCitation(row)));
      tableRow.appendChild(createCell(row.provenance, 'references-provenance'));
      tableRow.appendChild(createCell(row.note, 'references-note'));
    }
  );
}

export function renderReferences(dataset = getDataset()) {
  const container = document.getElementById('references-content');
  if (!container) {
    console.warn('References content container not found.');
    return;
  }

  const references = dataset?.references || [];
  const evidence = dataset?.interaction_evidence || [];
  const interactions = dataset?.interactions || [];
  const citedEvidence = evidence.filter(
    (row) => row.doi || row.pmid || row.database_accession
  ).length;

  container.replaceChildren();

  const meta = document.createElement('p');
  meta.className = 'references-meta';
  meta.textContent = [
    plural(references.length, 'DOI reference'),
    plural(evidence.length, 'interaction-evidence record'),
    plural(interactions.length, 'interaction'),
    `${citedEvidence} with citation identifiers`,
  ].join(' · ');
  container.appendChild(meta);

  const referencesBlock = createDetails('References', `(${references.length})`);
  referencesBlock.body.appendChild(renderReferencesTable(references));
  container.appendChild(referencesBlock.details);

  const evidenceBlock = createDetails('Interaction evidence', `(${evidence.length})`);
  const evidenceMeta = document.createElement('p');
  evidenceMeta.className = 'references-meta';
  evidenceMeta.textContent = evidenceSummary(evidence);
  evidenceBlock.body.appendChild(evidenceMeta);
  evidenceBlock.body.appendChild(renderEvidenceTable(evidence));
  container.appendChild(evidenceBlock.details);
}

/* Module 04 - Functional Enrichment (hypergeometric test with Benjamini-Hochberg FDR). */

import { annotationLabels, eligible, round, unique } from '../utils.js';

const factorialCache = [0, 0];

function logFactorial(n) {
  while (factorialCache.length <= n) {
    factorialCache.push(factorialCache[factorialCache.length - 1] + Math.log(factorialCache.length));
  }
  return factorialCache[n];
}

function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

function hypergeometricSurvival(N, K, n, k) {
  if (k <= 0) return 1;
  const upper = Math.min(n, K);
  if (k > upper) return 0;

  const denominator = logChoose(N, n);
  let logSum = -Infinity;
  for (let i = k; i <= upper; i += 1) {
    const term = logChoose(K, i) + logChoose(N - K, n - i) - denominator;
    if (term > logSum) logSum = term;
    else if (term > -Infinity) logSum += Math.log1p(Math.exp(term - logSum));
  }
  return Math.exp(logSum);
}

function benjaminiHochberg(pValues) {
  const indexed = pValues.map((p, index) => ({ p, index }));
  indexed.sort((a, b) => a.p - b.p);
  const m = indexed.length;
  const adjusted = new Array(m);
  let running = 1;

  for (let i = m - 1; i >= 0; i -= 1) {
    const rank = i + 1;
    running = Math.min(running, (indexed[i].p * m) / rank);
    adjusted[indexed[i].index] = Math.min(1, running);
  }
  return adjusted;
}

function pathwaysFor(protein) {
  return unique([
    ...annotationLabels(protein.pathways),
    ...annotationLabels(protein.pathway),
    ...annotationLabels(protein.pathways_detailed),
  ]);
}

export default {
  id: 'functional-enrichment',
  number: '04',
  name: 'Functional Enrichment',
  question: 'Are any host pathways over-represented among effector-associated proteins?',
  description: 'Hypergeometric test with false-discovery-rate control and explicit background.',

  canRun(dataset) {
    const reasons = [];
    const annotated = (dataset?.host_proteins || []).filter((protein) => pathwaysFor(protein).length > 0);
    if (annotated.length < 2) reasons.push('At least two annotated host proteins are required.');
    if ((dataset?.interactions?.length || 0) === 0) reasons.push('Interactions are required to define the query protein set.');
    return eligible(reasons.length === 0, reasons);
  },

  run(dataset) {
    const proteins = dataset.host_proteins || [];
    const annotated = proteins.filter((protein) => pathwaysFor(protein).length > 0);
    const keyOf = (protein) => protein.entity_id ?? protein.host_protein_id;
    const byAnyId = new Map();
    annotated.forEach((protein) => {
      [protein.entity_id, protein.host_protein_id].forEach((id) => {
        if (id !== undefined && id !== null) byAnyId.set(id, protein);
      });
    });
    const queryIds = new Set(
      (dataset.interactions || [])
        .map((interaction) => byAnyId.get(interaction.host_protein_id))
        .filter(Boolean)
        .map(keyOf)
    );
    const query = annotated.filter((protein) => queryIds.has(keyOf(protein)));
    const N = annotated.length;
    const n = query.length;

    const pathwaySets = new Map();
    annotated.forEach((protein) => {
      pathwaysFor(protein).forEach((pathway) => {
        const set = pathwaySets.get(pathway) || new Set();
        set.add(keyOf(protein));
        pathwaySets.set(pathway, set);
      });
    });

    const terms = [...pathwaySets.entries()].map(([pathway, ids]) => ({
      pathway,
      K: ids.size,
      k: [...ids].filter((id) => queryIds.has(id)).length,
      ids,
    }));

    const pValues = terms.map((term) => hypergeometricSurvival(N, term.K, n, term.k));
    const qValues = benjaminiHochberg(pValues);

    const rows = terms
      .map((term, index) => {
        const contributors = annotated
          .filter((protein) => term.ids.has(keyOf(protein)) && queryIds.has(keyOf(protein)))
          .map((protein) => protein.protein_name || protein.entity_id);
        return {
          pathway: term.pathway,
          k: term.k,
          n,
          K: term.K,
          N,
          p_value: round(pValues[index], 6),
          q_value: round(qValues[index], 6),
          significant: qValues[index] <= 0.05 ? 'yes' : 'no',
          contributing_proteins: contributors.join(', ') || '—',
        };
      })
      .sort((a, b) => a.q_value - b.q_value || b.k - a.k);

    const significant = rows.filter((row) => row.significant === 'yes');

    return {
      metrics: [
        { label: 'Background proteins', value: String(N) },
        { label: 'Query proteins', value: String(n) },
        { label: 'Terms tested', value: String(rows.length) },
        { label: 'Significant after FDR', value: String(significant.length) },
      ],
      findings: significant.slice(0, 5).map((row) => `${row.pathway}: ${row.k}/${row.n} query proteins (q = ${row.q_value})`),
      tables: [
        {
          title: 'Enrichment results',
          columns: [
            { key: 'pathway', label: 'Pathway' },
            { key: 'k', label: 'k' },
            { key: 'n', label: 'n' },
            { key: 'K', label: 'K' },
            { key: 'N', label: 'N' },
            { key: 'p_value', label: 'p-value' },
            { key: 'q_value', label: 'q-value' },
            { key: 'significant', label: 'FDR ≤ 0.05' },
            { key: 'contributing_proteins', label: 'Contributing proteins' },
          ],
          rows,
        },
      ],
      notes: [
        'Background = all annotated host proteins in the upload; query = host proteins with uploaded interactions.',
        'q-values use Benjamini-Hochberg correction across all tested pathways.',
        'Small sets and incomplete annotations produce unstable results; do not treat q-values as proof of mechanism.',
      ],
      warnings: n < 3 ? ['Fewer than three query proteins; interpret enrichment cautiously.'] : [],
    };
  },

  validate(result) {
    const rows = result.tables?.[0]?.rows || [];
    const issues = rows
      .filter((row) => row.p_value === null || row.q_value === null)
      .map((row) => `Missing statistics for ${row.pathway}.`);
    return { valid: issues.length === 0, issues };
  },
};

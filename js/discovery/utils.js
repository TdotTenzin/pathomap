/* Small shared helpers for discovery modules. */

export function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))];
}

export function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

export function mean(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

export function sampleSd(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length < 2) return 0;
  const average = mean(numbers);
  const variance = numbers.reduce((sum, value) => sum + (value - average) ** 2, 0) / (numbers.length - 1);
  return Math.sqrt(variance);
}

export function round(value, digits = 3) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function percent(value, digits = 1) {
  return value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;
}

export function jaccard(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 && right.size === 0) return 1;
  const intersection = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

export function splitList(value) {
  return String(value ?? '')
    .split(/[;|]|\s,\s/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function annotationLabels(value) {
  if (Array.isArray(value)) {
    return unique(value.flatMap((item) => annotationLabels(item)));
  }
  if (value && typeof value === 'object') {
    const label = value.name || value.term || value.label || value.id || value.accession;
    return label ? [String(label).trim()].filter(Boolean) : [];
  }
  return splitList(value);
}

export function countBy(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export function eligible(ok, reasons = []) {
  return { eligible: ok, reasons: ok ? [] : reasons };
}

export function requireRows(dataset, table, count = 1) {
  const rows = dataset?.[table];
  if (!Array.isArray(rows) || rows.length < count) {
    return [`Table "${table}" needs at least ${count} row(s).`];
  }
  return [];
}

export function requireField(dataset, table, field) {
  const rows = dataset?.[table] || [];
  if (rows.length === 0) return [`Table "${table}" needs at least one row.`];
  if (!rows.some((row) => row?.[field] !== undefined && row?.[field] !== null && row[field] !== '')) {
    return [`Column "${field}" is missing or empty in "${table}".`];
  }
  return [];
}

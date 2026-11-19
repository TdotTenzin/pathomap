/*
  format.js - Shared text and date formatting helpers.
*/

export function pluralize(count, singular, pluralForm = `${singular}s`) {
  const value = typeof count === 'number' ? count.toLocaleString() : count;
  return `${value} ${count === 1 ? singular : pluralForm}`;
}

export function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function formatDateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

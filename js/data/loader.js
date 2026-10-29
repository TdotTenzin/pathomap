import { normalizeDataset } from '../utils/dataset.js';

export const DEFAULT_DATASET_URL = 'data/pathomap-dataset.json';

let dataset = normalizeDataset({ pathogens: [] });

export async function loadDataset(url = DEFAULT_DATASET_URL) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
  }
  const data = await response.json();
  setDataset(data);
  return dataset;
}

export function setDataset(data) {
  dataset = normalizeDataset(data);
  return dataset;
}

export function getDataset() {
  return dataset;
}

export function getPathogens() {
  return dataset.pathogens;
}

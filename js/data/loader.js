import { normalizeDataset } from '../utils/dataset.js';

// Default URL for the curated PathoMap dataset
export const DEFAULT_DATASET_URL = 'data/pathomap-dataset.json';

// In-memory dataset storage
let dataset = normalizeDataset({ pathogens: [], effectors: [], host_proteins: [] });

// Load dataset from a URL
export async function loadDataset(url = DEFAULT_DATASET_URL) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
  }
  const data = await response.json();
  setDataset(data);
  return dataset;
}

// Set the current dataset (normalizes data structure)
export function setDataset(data) {
  dataset = normalizeDataset(data);
  return dataset;
}

// Get the current dataset
export function getDataset() {
  return dataset;
}

// Get the pathogens array from the current dataset
export function getPathogens() {
  return dataset.pathogens;
}

// Get the effectors array from the current dataset
export function getEffectors() {
  return dataset.effectors || [];
}

// Get the host_proteins array from the current dataset
export function getHostProteins() {
  return dataset.host_proteins || [];
}

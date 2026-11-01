/*
  loader.js - Dataset loading and in-memory access layer.

  Purpose: Owns the single in-memory copy of the dataset and exposes getters
  so UI modules never touch fetch/DOM directly. All data enters the app
  through this module (either from the built-in JSON or a user upload).

  Exports:
    DEFAULT_DATASET_URL  Constant path to the curated dataset JSON.
    loadDataset(url)     Fetch + parse + normalize a dataset; returns the
                         normalized object and replaces the in-memory copy.
    setDataset(data)     Replace the in-memory dataset (used by upload.js).
    getDataset()         Return the whole in-memory dataset object.
    getPathogens()       Shorthand for dataset.pathogens.
    getEffectors()       Shorthand for dataset.effectors (defaults to []).
    getHostProteins()    Shorthand for dataset.host_proteins (defaults to []).

  Internal state:
    dataset  Module-scoped variable holding the normalized dataset. Starts as
             an empty normalized structure so getters never crash before load.

  Note: Normalization is delegated to normalizeDataset() (js/utils/dataset.js)
  so both the fetch path and the upload path share identical cleaning logic.
*/

import { normalizeDataset } from '../utils/dataset.js';

// Default URL for the curated PathoMap dataset
export const DEFAULT_DATASET_URL = 'data/pathomap-dataset.json';

// In-memory dataset storage (module-scoped singleton)
let dataset = normalizeDataset({ pathogens: [], effectors: [], host_proteins: [] });

// Load dataset from a URL: fetch JSON, normalize, store, and return it
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

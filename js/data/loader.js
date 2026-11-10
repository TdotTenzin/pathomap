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
    loadStoredDataset()  Restore the last persisted dataset, or null.
    getDataset()         Return the whole in-memory dataset object.
    getPathogens()       Shorthand for dataset.pathogens.
    getEffectors()       Shorthand for dataset.effectors (defaults to []).
    getHostProteins()    Shorthand for dataset.host_proteins (defaults to []).
    getHostTargets()     Shorthand for dataset.host_targets (defaults to []).
    getReferences()      Shorthand for dataset.references (defaults to []).

  Internal state:
    dataset  Module-scoped variable holding the normalized dataset. Starts as
             an empty normalized structure so getters never crash before load.

  Persistence:
    Every setDataset()/loadDataset() call mirrors the normalized dataset into
    localStorage (key `pathomap-dataset`). Standalone pages such as
    interaction-analysis.html use loadStoredDataset() so a dataset loaded or
    uploaded on index.html carries across navigation.

  Note: Normalization is delegated to normalizeDataset() (js/utils/dataset.js)
  so both the fetch path and the upload path share identical cleaning logic.
*/

import { normalizeDataset } from '../utils/dataset.js';

// Default URL for the curated PathoMap dataset
export const DEFAULT_DATASET_URL = 'data/pathomap-dataset.json';

// localStorage key used to carry the dataset between standalone pages
const STORAGE_KEY = 'pathomap-dataset';

// In-memory dataset storage (module-scoped singleton)
let dataset = normalizeDataset({
  pathogens: [], effectors: [], host_proteins: [], host_targets: [], references: [],
  interactions: [], interaction_evidence: [],
});

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
  persistDataset(dataset);
  return dataset;
}

// Mirror the dataset into localStorage so other pages can reuse it. Failures
// (quota exceeded, storage disabled) are non-fatal: the in-memory copy remains.
function persistDataset(normalized) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch (error) {
    console.warn('Could not persist dataset to localStorage.', error);
  }
}

// Restore the dataset persisted by a previous page load, or null when absent
export function loadStoredDataset() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    dataset = normalizeDataset(JSON.parse(stored));
    return dataset;
  } catch (error) {
    console.warn('Could not restore persisted dataset.', error);
    return null;
  }
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

// Get the audited host-target array from the current dataset.
export function getHostTargets() {
  return dataset.host_targets || [];
}

// Get the normalized reference array from the current dataset.
export function getReferences() {
  return dataset.references || [];
}

export function getInteractions() {
  return dataset.interactions || [];
}

export function getInteractionEvidence() {
  return dataset.interaction_evidence || [];
}

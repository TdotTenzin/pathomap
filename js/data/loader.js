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
    clearStoredDataset() Remove a stale dataset cached by an older version.
    getDataset()         Return the whole in-memory dataset object.
    getPathogens()       Shorthand for dataset.pathogens.
    getEffectors()       Shorthand for dataset.effectors (defaults to []).
    getHostProteins()    Shorthand for dataset.host_proteins (defaults to []).
    getHostTargets()     Shorthand for dataset.host_targets (defaults to []).

  Internal state:
    dataset  Module-scoped variable holding the normalized dataset. Starts as
             an empty normalized structure so getters never crash before load.

  Persistence:
    None. Datasets live only in memory for the current page view. A stale
    `pathomap-dataset` key written by an older build is removed at boot so a
    previous session's results can never appear without an explicit action.

  Note: Normalization is delegated to normalizeDataset() (js/utils/dataset.js)
  so both the fetch path and the upload path share identical cleaning logic.
*/

import { normalizeDataset } from '../utils/dataset.js';

// Default URLs for the built-in datasets (relative to pages/ directory)
export const DEFAULT_DATASET_URL = '../data/pathomap-dataset.json';
export const DEFAULT_SAMPLE_DATASET_URL = '../data/sample-dataset.json';

// Shared hint shown when a fetch fails because the site is opened as a file
export const HTTP_SETUP_HINT = 'Serve the site over HTTP (for example, python -m http.server).';

// Legacy key written by older builds; removed once at boot, never read.
const LEGACY_STORAGE_KEY = 'pathomap-dataset';

// In-memory dataset storage (module-scoped singleton)
let dataset = normalizeDataset({
  pathogens: [], effectors: [], host_proteins: [], host_targets: [], references: [],
  interactions: [], interaction_evidence: [],
});

async function sha256Hex(buffer) {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Single ingest path: validate/annotate meta and normalize into memory only.
function ingestDataset(data, { sha256 } = {}) {
  const normalized = normalizeDataset(
    sha256
      ? { ...(data || {}), meta: { ...(data?.meta || {}), source_dataset_sha256: sha256 } }
      : data
  );
  dataset = normalized;
  return normalized;
}

// Load dataset from a URL: fetch JSON, normalize, store, and return it
export async function loadDataset(url = DEFAULT_DATASET_URL) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
  }
  const buffer = await response.arrayBuffer();
  const data = JSON.parse(new TextDecoder().decode(buffer));
  const sha256 = await sha256Hex(buffer);
  return ingestDataset(data, { sha256 });
}

// Set the current dataset (normalizes data structure)
export function setDataset(data) {
  return ingestDataset(data);
}

// Delete any dataset cached by a previous build. Store-disabled environments
// are fine: there is nothing to clean up.
export function clearStoredDataset() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (error) {
    console.warn('Could not clear the legacy dataset cache.', error);
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

export function getInteractions() {
  return dataset.interactions || [];
}

export function getReferences() {
  return dataset.references || [];
}

export function getInteractionEvidence() {
  return dataset.interaction_evidence || [];
}

/*
  dataset-handoff.js - One-shot dataset transfer into a module page.

  No localStorage and no boot-time restore. A dataset is written only when a
  user follows a link to a module page, and the receiving page consumes and
  clears it immediately.
*/

const HANDOFF_KEY = 'pathomap-module-dataset';

export function queueDatasetForModule(dataset) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(dataset));
  } catch (error) {
    console.warn('Could not queue dataset for module page.', error);
  }
}

export function consumeQueuedDataset() {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(HANDOFF_KEY);
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Could not read queued dataset for module page.', error);
    return null;
  }
}

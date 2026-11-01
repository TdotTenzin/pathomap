/*
  upload.js - Dataset upload / load UI controller.

  Purpose: Manages the upload bar in index.html — lets users pick a JSON file,
  load the built-in curated or sample dataset, and download an empty template.
  Every load path validates first, then swaps the in-memory dataset and
  triggers a re-render of the database view.

  Exports:
    initUpload({ render })   Binds all upload-bar event listeners. `render` is
                             a callback (usually renderDatabase) invoked after
                             the dataset changes.
    setUploadStatus(msg, state)  Writes a status line into #dataset-status;
                             `state` is '', 'success', 'warning', or 'error'
                             (drives the colored status text via data-state).

  Internal functions:
    warningSuffix(warnings)  Appends "N warning(s)" text for status messages.
    applyData(data, label)   Validates + stores a parsed dataset; shows an
                             error and aborts if validation fails hard.
    downloadBlob(text, name, type)  Creates a Blob, triggers a browser
                             download, then revokes the object URL.

  DOM elements it binds to (all defined in index.html):
    #dataset-file            <input type="file"> — JSON file picker
    #file-input-name         Displays the chosen file name
    #dataset-load-builtin    Button: load data/pathomap-dataset.json
    #dataset-load-sample     Button: load data/sample-dataset.json
    #dataset-download-template  Button: download empty template JSON
    #dataset-status          Status message element (via setUploadStatus)

  Note: The file-upload path uses FileReader (async read) then JSON.parse;
  malformed JSON or validation errors surface as status-bar messages.
*/

import { DEFAULT_DATASET_URL, loadDataset, setDataset } from '../data/loader.js';
import { SCHEMA_VERSION } from '../data/schema.js';
import { validateDataset } from '../utils/dataset.js';

// Callback to re-render the database view after data changes
let renderCallback = () => {};

// Set the status message in the upload UI (state drives color: success/warning/error)
export function setUploadStatus(message, state = '') {
  const el = document.getElementById('dataset-status');
  if (!el) return;
  el.textContent = message || '';
  if (state) {
    el.dataset.state = state;
  } else {
    delete el.dataset.state;
  }
}

// Generate a suffix message for validation warnings ("N warning(s).")
function warningSuffix(warnings) {
  if (!warnings.length) return '';
  return ` ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`;
}

// Validate and apply new dataset data: rejects on hard errors, otherwise
// stores the data, re-renders, and reports row count + warnings
function applyData(data, sourceLabel) {
  const result = validateDataset(data);
  if (!result.valid) {
    setUploadStatus(`Invalid dataset: ${result.errors[0]}`, 'error');
    console.warn('PathoMap dataset validation errors:', result.errors);
    return false;
  }

  setDataset(data);
  renderCallback();
  const count = Array.isArray(data.pathogens) ? data.pathogens.length : 0;
  setUploadStatus(
    `${sourceLabel} loaded: ${count} pathogen${count === 1 ? '' : 's'}.${warningSuffix(result.warnings)}`,
    result.warnings.length ? 'warning' : 'success'
  );
  if (result.warnings.length) {
    console.warn('PathoMap dataset validation warnings:', result.warnings);
  }
  return true;
}

// Download a text blob as a file (creates a temp object URL and cleans it up)
function downloadBlob(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// Initialize upload UI with event listeners for file input and dataset loading
export function initUpload({ render } = {}) {
  renderCallback = typeof render === 'function' ? render : () => {};

  const fileInput = document.getElementById('dataset-file');
  const fileName = document.getElementById('file-input-name');

  // Handle file upload via file input: read as text, parse JSON, apply
  if (fileInput) {
    fileInput.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (fileName) fileName.textContent = file ? file.name : '';
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        try {
          const data = JSON.parse(loadEvent.target.result);
          applyData(data, file.name);
        } catch (error) {
          setUploadStatus('Could not parse that file as JSON.', 'error');
          console.error(error);
        }
      };
      reader.onerror = () => setUploadStatus('Could not read that file.', 'error');
      reader.readAsText(file);
    });
  }

  // Load the built-in curated dataset (full pathomap-dataset.json)
  const loadBuiltin = document.getElementById('dataset-load-builtin');
  if (loadBuiltin) {
    loadBuiltin.addEventListener('click', () => {
      setUploadStatus('Loading curated dataset...');
      loadDataset(DEFAULT_DATASET_URL)
        .then((dataset) => {
          renderCallback();
          const count = dataset.pathogens.length;
          setUploadStatus(
            `Curated dataset loaded: ${count} pathogen${count === 1 ? '' : 's'}.`,
            'success'
          );
        })
        .catch((error) => {
          setUploadStatus(
            'Could not load data/pathomap-dataset.json. Serve the site over HTTP (for example, python -m http.server).',
            'error'
          );
          console.error(error);
        });
    });
  }

  // Load the small sample dataset (5 pathogens) for quick demos/tests
  const loadSample = document.getElementById('dataset-load-sample');
  if (loadSample) {
    loadSample.addEventListener('click', () => {
      setUploadStatus('Loading sample dataset...');
      loadDataset('data/sample-dataset.json')
        .then((dataset) => {
          renderCallback();
          const count = dataset.pathogens.length;
          setUploadStatus(
            `Sample dataset loaded: ${count} pathogen${count === 1 ? '' : 's'}.`,
            'success'
          );
        })
        .catch((error) => {
          setUploadStatus('Could not load data/sample-dataset.json.', 'error');
          console.error(error);
        });
    });
  }

  // Download a template JSON file for users to fill in
  const downloadTemplate = document.getElementById('dataset-download-template');
  if (downloadTemplate) {
    downloadTemplate.addEventListener('click', () => {
      // Minimal valid skeleton: meta block + empty pathogens array
      const template = {
        meta: {
          dataset: 'pathomap',
          schema_version: SCHEMA_VERSION,
          tables: { pathogens: 0 },
        },
        pathogens: [],
      };
      downloadBlob(
        JSON.stringify(template, null, 2) + '\n',
        'pathomap-pathogens-template.json',
        'application/json'
      );
      setUploadStatus('Template downloaded. Only the pathogens array is required.', 'success');
    });
  }
}

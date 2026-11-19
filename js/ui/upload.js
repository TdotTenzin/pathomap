
/*
  upload.js - Dataset upload / load UI controller.

  Purpose: Manages the upload bar in index.html — lets users pick a JSON file,
  load the built-in curated or sample dataset, and download an empty template.
  Every load path validates first, then swaps the in-memory dataset and
  triggers a re-render of the database view and analysis eligibility.

  Exports:
    initUpload({ render })   Binds all upload-bar event listeners. `render` is
                             a callback invoked after the dataset changes,
                             receiving the updated normalized dataset.
    setUploadStatus(msg, state)  Writes a status line into #dataset-status;
                             `state` is '', 'success', 'warning', or 'error'
                             (drives the colored status text via data-state).

  Internal functions:
    formatWarningSuffix(warnings)  Appends "N warning(s)" text for status messages.
    applyDataset(data, label)      Validates + stores a parsed dataset; shows an
                                   error and aborts if validation fails hard.
    (downloads use downloadText() from js/utils/export.js)

  DOM elements it binds to (all defined in index.html):
    #dataset-file               <input type="file"> — JSON file picker
    #dataset-file-name           Displays the chosen file name
    #dataset-load-builtin        Button: load data/pathomap-dataset.json
    #dataset-load-sample         Button: load data/sample-dataset.json
    #dataset-download-template   Button: download empty template JSON
    #dataset-status              Status message element (via setUploadStatus)

  Note: The file-upload path uses FileReader (async read) then JSON.parse;
  malformed JSON or validation errors surface as status-bar messages.
*/

import {
    DEFAULT_DATASET_URL,
    DEFAULT_SAMPLE_DATASET_URL,
    HTTP_SETUP_HINT,
    loadDataset,
    setDataset,
} from '../data/loader.js';
import { SCHEMA_VERSION } from '../data/schema.js';
import { validateDataset } from '../utils/dataset.js';
import { downloadText } from '../utils/export.js';
import { pluralize } from '../utils/format.js';

// Callback to re-render the application after data changes
let renderCallback = () => {};

// Set the status message in the upload UI
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

// Generate a suffix message for validation warnings
function formatWarningSuffix(warnings) {
  if (!warnings.length) return '';
  return ` ${pluralize(warnings.length, 'warning')}.`;
}

// Validate and apply new dataset data
function applyDataset(data, sourceLabel) {
  const result = validateDataset(data);

  if (!result.valid) {
    setUploadStatus(`Invalid dataset: ${result.errors[0]}`, 'error');
    console.warn('PathoMap dataset validation errors:', result.errors);
    return false;
  }

  const updatedDataset = setDataset(data);

  // Refresh database and analysis eligibility
  renderCallback(updatedDataset);

  const count = Array.isArray(updatedDataset.pathogens)
    ? updatedDataset.pathogens.length
    : 0;

  setUploadStatus(
    `${sourceLabel} loaded: ${pluralize(count, 'pathogen')}.${formatWarningSuffix(result.warnings)}`,
    result.warnings.length ? 'warning' : 'success'
  );

  if (result.warnings.length) {
    console.warn('PathoMap dataset validation warnings:', result.warnings);
  }

  return true;
}

// Initialize upload UI with event listeners
export function initUpload({ render } = {}) {
  renderCallback = typeof render === 'function' ? render : () => {};

  const fileInput = document.getElementById('dataset-file');
  const fileName = document.getElementById('dataset-file-name');

  // Handle file upload via file input
  if (fileInput) {
    fileInput.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];

      if (fileName) {
        fileName.textContent = file ? file.name : '';
      }

      if (!file) return;

      const reader = new FileReader();

      reader.onload = (loadEvent) => {
        try {
          const data = JSON.parse(loadEvent.target.result);
          applyDataset(data, file.name);
        } catch (error) {
          setUploadStatus('Could not parse that file as JSON.', 'error');
          console.error(error);
        }
      };

      reader.onerror = () => {
        setUploadStatus('Could not read that file.', 'error');
      };

      reader.readAsText(file);
    });
  }

  // Load the built-in curated dataset
  const loadBuiltin = document.getElementById('dataset-load-builtin');

  if (loadBuiltin) {
    loadBuiltin.addEventListener('click', () => {
      setUploadStatus('Loading curated dataset...');

      loadDataset(DEFAULT_DATASET_URL)
        .then((dataset) => {
          renderCallback(dataset);

          const count = dataset.pathogens.length;

          setUploadStatus(
            `Curated dataset loaded: ${pluralize(count, 'pathogen')}.`,
            'success'
          );
        })
        .catch((error) => {
          setUploadStatus(
            `Could not load ${DEFAULT_DATASET_URL}. ${HTTP_SETUP_HINT}`,
            'error'
          );

          console.error(error);
        });
    });
  }

  // Load the small sample dataset
  const loadSample = document.getElementById('dataset-load-sample');

  if (loadSample) {
    loadSample.addEventListener('click', () => {
      setUploadStatus('Loading sample dataset...');

      loadDataset(DEFAULT_SAMPLE_DATASET_URL)
        .then((dataset) => {
          renderCallback(dataset);

          const count = dataset.pathogens.length;

          setUploadStatus(
            `Sample dataset loaded: ${pluralize(count, 'pathogen')}.`,
            'success'
          );
        })
        .catch((error) => {
          setUploadStatus(`Could not load ${DEFAULT_SAMPLE_DATASET_URL}.`, 'error');
          console.error(error);
        });
    });
  }

  // Download a template JSON file
  const downloadTemplate = document.getElementById('dataset-download-template');

  if (downloadTemplate) {
    downloadTemplate.addEventListener('click', () => {
      const template = {
        meta: {
          dataset: 'pathomap',
          schema_version: SCHEMA_VERSION,
          tables: { pathogens: 0 },
        },
        pathogens: [],
      };

      downloadText(
        JSON.stringify(template, null, 2) + '\n',
        'pathomap-pathogens-template.json',
        'application/json'
      );

      setUploadStatus(
        'Template downloaded. Only the pathogens array is required.',
        'success'
      );
    });
  }
}

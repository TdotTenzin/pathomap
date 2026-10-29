import { DEFAULT_DATASET_URL, loadDataset, setDataset } from '../data/loader.js';
import { SCHEMA_VERSION } from '../data/schema.js';
import { validateDataset } from '../utils/dataset.js';

let renderCallback = () => {};

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

function warningSuffix(warnings) {
  if (!warnings.length) return '';
  return ` ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`;
}

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

export function initUpload({ render } = {}) {
  renderCallback = typeof render === 'function' ? render : () => {};

  const fileInput = document.getElementById('dataset-file');
  const fileName = document.getElementById('file-input-name');

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
      downloadBlob(
        JSON.stringify(template, null, 2) + '\n',
        'pathomap-pathogens-template.json',
        'application/json'
      );
      setUploadStatus('Template downloaded. Only the pathogens array is required.', 'success');
    });
  }
}

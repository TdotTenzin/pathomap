/*
  interaction-analysis.js - Entry script for the Interaction Analysis page.

  Purpose:
    Bootstraps page-level behavior: restores dark mode, fills the overview stat
    cards, and maintains the interaction filter state for the network view.

  Dataset source order:
    1. The dataset persisted by index.html (loadStoredDataset), so an uploaded
       or curated dataset carries across navigation.
    2. The default curated JSON via loadDataset() when nothing is stored.

  Filter behavior:
    - Search matches effector, host target, pathogen, and mechanism text.
    - Pathogen selects one organism or "All pathogens".
    - When "All pathogens" is active, an optional classification filter is
      offered (Gram-positive, Gram-negative, Virus, Fungus, Parasite).
    - When a specific pathogen is selected, the classification filter is hidden
      and the pathogen's classification is shown as read-only metadata.

  Stat definitions:
    - interactions  One interaction record per effector row (effector -> host target).
    - pathogens     Distinct pathogen names referenced by effectors.
    - effectors     Distinct effector names across all interaction records.
    - host-proteins Curated host proteins in the dataset's host_proteins table.
*/

import { initTheme } from '../ui/theme.js';
import { loadDataset, loadStoredDataset } from '../data/loader.js';

initTheme();

// Classification categories exposed by the UI filter
const CLASSIFICATIONS = [
    'Gram-positive',
    'Gram-negative',
    'Virus',
    'Fungus',
    'Parasite',
];
const UNCLASSIFIED = 'Unclassified';

// Current filter state; records are rebuilt from the dataset on load
const state = {
    records: [],
    pathogenInfo: new Map(),
    search: '',
    pathogen: '',
    classification: '',
};

// Cached DOM references (module scripts run after the HTML is parsed)
const els = {
    search: document.getElementById('ia-search'),
    pathogen: document.getElementById('ia-pathogen'),
    classification: document.getElementById('ia-classification'),
    classificationField: document.getElementById('ia-classification-field'),
    pathogenMeta: document.getElementById('ia-pathogen-meta'),
    pathogenClassification: document.getElementById('ia-pathogen-classification'),
    reset: document.getElementById('ia-reset'),
    statsStatus: document.getElementById('ia-stats-status'),
};

// Write a stat value, formatted with thousands separators
function setStat(key, value) {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el) el.textContent = Number(value).toLocaleString();
}

// Show or hide the status line under the stat cards
function setStatus(message) {
    if (!els.statsStatus) return;
    els.statsStatus.textContent = message || '';
    els.statsStatus.hidden = !message;
}

// Derive overview counts from the normalized dataset and update the cards
function renderStats(dataset) {
    const effectors = dataset.effectors || [];
    const hostProteins = dataset.host_proteins || [];

    // Each effector row represents one pathogen effector -> host target link
    const interactions = effectors.length;

    // Count unique names so duplicate records don't inflate the totals
    const uniquePathogens = new Set(
        effectors.map((row) => row.pathogen_name).filter(Boolean)
    );
    const uniqueEffectors = new Set(
        effectors.map((row) => row.effector_name).filter(Boolean)
    );

    // Fall back to the pathogens table when no effectors are linked yet
    const pathogens = uniquePathogens.size || dataset.pathogens.length;

    setStat('interactions', interactions);
    setStat('pathogens', pathogens);
    setStat('effectors', uniqueEffectors.size);
    setStat('host-proteins', hostProteins.length);
}

// Map a pathogen row to one UI classification. Gram stain covers bacteria;
// taxonomy hints cover viral/fungal/parasitic organisms in future datasets.
function classifyPathogen(row) {
    if (row.gram_stain === 'Gram-positive' || row.gram_stain === 'Gram-negative') {
        return row.gram_stain;
    }

    const text = [row.name, row.phylum, row.class_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    if (/(viricota|viridae|virus)/.test(text)) return 'Virus';
    if (/(ascomycota|basidiomycota|mucoromycota|chytridiomycota|microsporid|fungus|fungi)/.test(text)) {
        return 'Fungus';
    }
    if (/(apicomplexa|nematoda|platyhelminthes|kinetoplastida|amoebozoa|parasite|plasmodium|toxoplasma|trypanosoma|leishmania|giardia|entamoeba)/.test(text)) {
        return 'Parasite';
    }

    return UNCLASSIFIED;
}

// Build a name -> classification index used by records and the metadata line
function buildPathogenIndex(dataset) {
    return new Map(
        (dataset.pathogens || []).map((row) => [row.name, classifyPathogen(row)])
    );
}

// Flatten effector rows into display records with their classification
function buildRecords(dataset, pathogenIndex) {
    return (dataset.effectors || []).map((row) => ({
        effector: row.effector_name || '—',
        hostTarget: row.host_target || '—',
        pathogen: row.pathogen_name || '—',
        mechanism: row.mechanism || '—',
        classification: pathogenIndex.get(row.pathogen_name) || UNCLASSIFIED,
    }));
}

// Unique, sorted, non-empty values
function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// Replace a select's options with an "all" entry plus the supplied values
function populateSelect(select, values, allLabel) {
    if (!select) return;

    select.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = allLabel;
    select.appendChild(allOption);

    values.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    });
}

// Refresh the pathogen dropdown and the fixed classification dropdown
function populateFilters() {
    populateSelect(
        els.pathogen,
        uniqueSorted(state.records.map((record) => record.pathogen)),
        'All pathogens'
    );
    populateSelect(els.classification, CLASSIFICATIONS, 'All classifications');
}

// Toggle the classification filter vs. the read-only metadata for one pathogen
function updatePathogenUI() {
    const isSpecificPathogen = Boolean(state.pathogen);

    // Filter is only meaningful when browsing all pathogens
    if (els.classificationField) els.classificationField.hidden = isSpecificPathogen;
    if (els.pathogenMeta) els.pathogenMeta.hidden = !isSpecificPathogen;

    if (isSpecificPathogen && els.pathogenClassification) {
        els.pathogenClassification.textContent =
            state.pathogenInfo.get(state.pathogen) || UNCLASSIFIED;
    }
}

// Apply the current search + dropdown filters, returning matching records.
// Exported for the upcoming network view, which will consume this filtered set.
export function getFilteredRecords() {
    const query = state.search.trim().toLowerCase();

    return state.records.filter((record) => {
        if (state.pathogen && record.pathogen !== state.pathogen) return false;
        if (state.classification && record.classification !== state.classification) {
            return false;
        }
        if (!query) return true;

        // Match any displayed field so one search box covers the whole relationship
        return [record.effector, record.hostTarget, record.pathogen, record.mechanism]
            .some((value) => value.toLowerCase().includes(query));
    });
}

// Wire the search box, selects, and reset button
function bindFilters() {
    els.search?.addEventListener('input', (event) => {
        state.search = event.target.value;
    });

    els.pathogen?.addEventListener('change', (event) => {
        state.pathogen = event.target.value;

        // The classification filter is hidden for a single pathogen; clear it
        // so it cannot silently constrain results.
        if (state.pathogen) {
            state.classification = '';
            if (els.classification) els.classification.value = '';
        }

        updatePathogenUI();
    });

    els.classification?.addEventListener('change', (event) => {
        state.classification = event.target.value;
    });

    els.reset?.addEventListener('click', () => {
        state.search = '';
        state.pathogen = '';
        state.classification = '';

        if (els.search) els.search.value = '';
        if (els.pathogen) els.pathogen.value = '';
        if (els.classification) els.classification.value = '';

        updatePathogenUI();
        els.search?.focus();
    });
}

// Load the dataset, then populate stats and filter controls
async function initPage() {
    bindFilters();

    try {
        const stored = loadStoredDataset();
        const dataset = stored || (await loadDataset());

        state.pathogenInfo = buildPathogenIndex(dataset);
        state.records = buildRecords(dataset, state.pathogenInfo);

        renderStats(dataset);
        populateFilters();
        updatePathogenUI();
        setStatus('');
    } catch (error) {
        console.error('Could not load interaction data.', error);
        setStatus(
            'Could not load the dataset. Serve the site over HTTP (for example, python -m http.server) or load a dataset on the home page first.'
        );
    }
}

initPage();

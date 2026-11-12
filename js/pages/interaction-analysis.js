/*
  interaction-analysis.js - Entry script for the Interaction Analysis page.

  Boot:
    1. Restore a dataset loaded on index.html, or fetch the curated dataset.
    2. Fetch the optional Phase 4 derived analysis.
    3. Build/validate a network model, populate filters, and render the SVG view.

  Data source:
    The Phase 4 artifact is used only when its build timestamp, schema version
    and interaction count match the loaded dataset. Otherwise a display-only
    graph is built from the dataset interaction tables (sample/uploaded data).
*/

import { initTheme } from '../ui/theme.js';
import { loadDataset, loadStoredDataset } from '../data/loader.js';
import { loadInteractionAnalysis } from '../data/analysis.js';
import {
    UNCLASSIFIED,
    buildNetworkModel,
    filterNetwork,
    getFilterOptions,
} from '../analysis/network.js';
import { createNetworkView } from '../views/interaction-network.js';
import { downloadText, escapeXml, timestampSlug, toCsv } from '../utils/export.js';

initTheme();

const state = {
    dataset: null,
    model: null,
    filtered: null,
    filters: {
        search: '',
        pathogenId: '',
        hostProteinId: '',
        evidenceClass: '',
        interactionType: '',
        classification: '',
    },
};

const els = {
    search: document.getElementById('ia-search'),
    pathogen: document.getElementById('ia-pathogen'),
    hostProtein: document.getElementById('ia-host-protein'),
    evidence: document.getElementById('ia-evidence'),
    interactionType: document.getElementById('ia-interaction-type'),
    classification: document.getElementById('ia-classification'),
    classificationField: document.getElementById('ia-classification-field'),
    pathogenMeta: document.getElementById('ia-pathogen-meta'),
    pathogenClassification: document.getElementById('ia-pathogen-classification'),
    reset: document.getElementById('ia-reset'),
    statsStatus: document.getElementById('ia-stats-status'),
    networkSource: document.getElementById('ia-network-source'),
    networkStatus: document.getElementById('ia-network-status'),
    networkCanvas: document.getElementById('ia-network-canvas'),
    networkEmpty: document.getElementById('ia-network-empty'),
    networkControls: document.getElementById('ia-network-controls'),
    details: document.getElementById('ia-details'),
    exportMenu: document.querySelector('.ia-export'),
};

let searchTimer = null;

const view = createNetworkView({
    canvas: els.networkCanvas,
    details: els.details,
    empty: els.networkEmpty,
    status: els.networkStatus,
    controls: els.networkControls,
});

function setStat(key, value) {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el) el.textContent = Number(value).toLocaleString();
}

function setStatus(message) {
    if (!els.statsStatus) return;
    els.statsStatus.textContent = message || '';
    els.statsStatus.hidden = !message;
}

function uniqueCount(edges, key) {
    return new Set(edges.map((edge) => edge[key]).filter(Boolean)).size;
}

function renderStats(model) {
    setStat('interactions', model.interactionEdges.length);
    setStat('pathogens', uniqueCount(model.interactionEdges, 'pathogen_id'));
    setStat('effectors', uniqueCount(model.interactionEdges, 'source'));
    setStat('host-proteins', uniqueCount(model.interactionEdges, 'target'));
}

function formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function renderSourceNote(model) {
    if (!els.networkSource) return;

    if (model.source.kind === 'derived') {
        const stats = model.source.statistics || {};
        const unresolved = model.source.unresolvedTargets?.target_count ?? stats.unresolved_target_count;
        const unresolvedEffectors =
            model.source.unresolvedTargets?.effector_count ?? stats.unresolved_effector_count;
        const pieces = [
            `Phase 4 interaction analysis v${model.source.analysisVersion || '?'}`,
            `dataset built ${formatDate(model.source.datasetBuiltAt) || 'unknown'}`,
        ];
        if (Number.isFinite(Number(unresolved))) {
            pieces.push(
                `${Number(unresolved).toLocaleString()} unresolved targets (${Number(unresolvedEffectors || 0).toLocaleString()} effectors) excluded`
            );
        }
        if (model.source.datasetSha256) {
            pieces.push(`dataset SHA-256 ${model.source.datasetSha256.slice(0, 12)}...`);
        }
        els.networkSource.textContent = pieces.join(' - ');
        return;
    }

    els.networkSource.textContent =
        'Display-only network built from dataset interaction tables. Run python scripts/analyze_interactions.py for validated Phase 4 provenance.';
}

function populateSelect(select, values, allLabel) {
    if (!select) return;
    const current = select.value;
    select.replaceChildren();

    const all = document.createElement('option');
    all.value = '';
    all.textContent = allLabel;
    select.appendChild(all);

    values.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        select.appendChild(option);
    });

    if ([...select.options].some((option) => option.value === current)) {
        select.value = current;
    }
}

function populateFilters(model) {
    const options = getFilterOptions(model);

    populateSelect(els.pathogen, options.pathogens, 'All pathogens');
    populateSelect(els.hostProtein, options.hostProteins, 'All host proteins');
    populateSelect(
        els.evidence,
        options.evidenceClasses.map((value) => ({
            value,
            label: value.charAt(0).toUpperCase() + value.slice(1),
        })),
        'All evidence classes'
    );
    populateSelect(
        els.interactionType,
        options.interactionTypes.map((value) => ({ value, label: value })),
        'All interaction types'
    );
    populateSelect(
        els.classification,
        options.classifications.map((value) => ({ value, label: value })),
        'All classifications'
    );

    const selectedPathogen = options.pathogens.find((item) => item.value === state.filters.pathogenId);
    if (els.pathogenClassification) {
        els.pathogenClassification.textContent = selectedPathogen?.classification || UNCLASSIFIED;
    }
}

function updatePathogenUI() {
    const hasPathogen = Boolean(state.filters.pathogenId);
    if (els.classificationField) els.classificationField.hidden = hasPathogen;
    if (els.pathogenMeta) els.pathogenMeta.hidden = !hasPathogen;
}

function applyFilters() {
    if (!state.model) return;
    state.filtered = filterNetwork(state.model, state.filters);
    view.render(state.dataset, state.model, state.filtered);
}

function resetFilters() {
    state.filters = {
        search: '',
        pathogenId: '',
        hostProteinId: '',
        evidenceClass: '',
        interactionType: '',
        classification: '',
    };

    if (els.search) els.search.value = '';
    if (els.pathogen) els.pathogen.value = '';
    if (els.hostProtein) els.hostProtein.value = '';
    if (els.evidence) els.evidence.value = '';
    if (els.interactionType) els.interactionType.value = '';
    if (els.classification) els.classification.value = '';

    updatePathogenUI();
    refreshClassificationMeta();
    applyFilters();
    els.search?.focus();
}

function refreshClassificationMeta() {
    if (!state.model) return;
    const option = getFilterOptions(state.model).pathogens.find(
        (item) => item.value === state.filters.pathogenId
    );
    if (els.pathogenClassification) {
        els.pathogenClassification.textContent = option?.classification || UNCLASSIFIED;
    }
}

function bindFilters() {
    els.search?.addEventListener('input', (event) => {
        state.filters.search = event.target.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilters, 120);
    });

    els.pathogen?.addEventListener('change', (event) => {
        state.filters.pathogenId = event.target.value;
        if (state.filters.pathogenId) {
            state.filters.classification = '';
            if (els.classification) els.classification.value = '';
        }
        updatePathogenUI();
        refreshClassificationMeta();
        applyFilters();
    });

    els.hostProtein?.addEventListener('change', (event) => {
        state.filters.hostProteinId = event.target.value;
        applyFilters();
    });

    els.evidence?.addEventListener('change', (event) => {
        state.filters.evidenceClass = event.target.value;
        applyFilters();
    });

    els.interactionType?.addEventListener('change', (event) => {
        state.filters.interactionType = event.target.value;
        applyFilters();
    });

    els.classification?.addEventListener('change', (event) => {
        state.filters.classification = event.target.value;
        applyFilters();
    });

    els.reset?.addEventListener('click', resetFilters);
}

function nodeMaps(model) {
    return new Map(model.nodes.map((node) => [node.id, node]));
}

function evidenceFields(edge) {
    const records = edge.evidence_records || [];
    return {
        doi: [...new Set(records.map((record) => record.doi).filter(Boolean))].join('; '),
        pmid: [...new Set(records.map((record) => record.pmid).filter(Boolean))].join('; '),
        database_accession: [
            ...new Set(records.map((record) => record.database_accession).filter(Boolean)),
        ].join('; '),
    };
}

function activeFilterText() {
    const entries = Object.entries(state.filters).filter(([, value]) => value);
    return entries.length ? JSON.stringify(Object.fromEntries(entries)) : '';
}

function exportProvenance() {
    return {
        source_kind: state.model.source.kind,
        dataset_built_at: state.dataset?.meta?.built_at || null,
        dataset_schema_version: state.dataset?.meta?.schema_version || null,
        analysis_version: state.model.source.analysisVersion || null,
        analysis_generated_at: state.model.source.generatedAt || null,
        dataset_sha256: state.model.source.datasetSha256 || null,
        exported_at: new Date().toISOString(),
        filters: { ...state.filters },
        counts: state.filtered.counts,
    };
}

function exportJson() {
    const payload = {
        schema_version: '1.0',
        ...exportProvenance(),
        nodes: state.filtered.nodes,
        interaction_edges: state.filtered.interactionEdges,
        membership_edges: state.filtered.membershipEdges,
    };

    downloadText(
        `${JSON.stringify(payload, null, 2)}\n`,
        `pathomap-network-${timestampSlug()}.json`,
        'application/json;charset=utf-8'
    );
}

function exportNodesCsv() {
    const provenance = exportProvenance();
    const rows = state.filtered.nodes.map((node) => ({
        entity_id: node.id,
        type: node.type,
        label: node.label,
        gene_name: node.gene_name || '',
        uniprot_id: node.uniprot_id || '',
        pathogen_id: node.pathogen_id || '',
        tax_id: node.tax_id || '',
        classification: node.classification || '',
        source_kind: provenance.source_kind,
        dataset_built_at: provenance.dataset_built_at,
        analysis_version: provenance.analysis_version,
        exported_at: provenance.exported_at,
        active_filters: activeFilterText(),
    }));

    const columns = [
        { key: 'entity_id', label: 'entity_id' },
        { key: 'type', label: 'type' },
        { key: 'label', label: 'label' },
        { key: 'gene_name', label: 'gene_name' },
        { key: 'uniprot_id', label: 'uniprot_id' },
        { key: 'pathogen_id', label: 'pathogen_id' },
        { key: 'tax_id', label: 'tax_id' },
        { key: 'classification', label: 'classification' },
        { key: 'source_kind', label: 'source_kind' },
        { key: 'dataset_built_at', label: 'dataset_built_at' },
        { key: 'analysis_version', label: 'analysis_version' },
        { key: 'exported_at', label: 'exported_at' },
        { key: 'active_filters', label: 'active_filters' },
    ];

    downloadText(
        toCsv(columns, rows),
        `pathomap-network-nodes-${timestampSlug()}.csv`,
        'text/csv;charset=utf-8'
    );
}

function exportEdgesCsv() {
    const provenance = exportProvenance();
    const byId = nodeMaps(state.filtered);

    const rows = state.filtered.interactionEdges.map((edge) => {
        const effector = byId.get(edge.source);
        const host = byId.get(edge.target);
        const pathogen = byId.get(edge.pathogen_id);
        const evidence = evidenceFields(edge);
        return {
            interaction_id: edge.id,
            interaction_type: edge.type,
            mechanism: edge.mechanism || '',
            pathogen_id: edge.pathogen_id || '',
            pathogen_name: pathogen?.label || edge.pathogen_name || '',
            effector_id: edge.source,
            effector_name: effector?.label || '',
            host_protein_id: edge.target,
            host_gene: host?.gene_name || '',
            host_protein: host?.label || '',
            host_uniprot: host?.uniprot_id || '',
            evidence_classes: (edge.evidence_classes || []).join('; '),
            strongest_evidence_class: edge.strongest_evidence_class || '',
            evidence_count: edge.evidence_count || 0,
            doi: evidence.doi,
            pmid: evidence.pmid,
            database_accession: evidence.database_accession,
            provenance: edge.provenance || '',
            source_kind: provenance.source_kind,
            dataset_built_at: provenance.dataset_built_at,
            analysis_version: provenance.analysis_version,
            exported_at: provenance.exported_at,
            active_filters: activeFilterText(),
        };
    });

    const columns = [
        { key: 'interaction_id', label: 'interaction_id' },
        { key: 'interaction_type', label: 'interaction_type' },
        { key: 'mechanism', label: 'mechanism' },
        { key: 'pathogen_id', label: 'pathogen_id' },
        { key: 'pathogen_name', label: 'pathogen_name' },
        { key: 'effector_id', label: 'effector_id' },
        { key: 'effector_name', label: 'effector_name' },
        { key: 'host_protein_id', label: 'host_protein_id' },
        { key: 'host_gene', label: 'host_gene' },
        { key: 'host_protein', label: 'host_protein' },
        { key: 'host_uniprot', label: 'host_uniprot' },
        { key: 'evidence_classes', label: 'evidence_classes' },
        { key: 'strongest_evidence_class', label: 'strongest_evidence_class' },
        { key: 'evidence_count', label: 'evidence_count' },
        { key: 'doi', label: 'doi' },
        { key: 'pmid', label: 'pmid' },
        { key: 'database_accession', label: 'database_accession' },
        { key: 'provenance', label: 'provenance' },
        { key: 'source_kind', label: 'source_kind' },
        { key: 'dataset_built_at', label: 'dataset_built_at' },
        { key: 'analysis_version', label: 'analysis_version' },
        { key: 'exported_at', label: 'exported_at' },
        { key: 'active_filters', label: 'active_filters' },
    ];

    downloadText(
        toCsv(columns, rows),
        `pathomap-network-edges-${timestampSlug()}.csv`,
        'text/csv;charset=utf-8'
    );
}

function exportSvg() {
    const provenance = exportProvenance();
    const svg = view.serializeSvg(provenance);
    if (!svg) return;

    const withTitle = svg.replace(
        '</metadata>',
        `</metadata>\n<desc>${escapeXml(
            `PathoMap interaction network. ${provenance.counts.interactions} interactions, exported ${provenance.exported_at}.`
        )}</desc>`
    );

    downloadText(withTitle, `pathomap-network-${timestampSlug()}.svg`, 'image/svg+xml;charset=utf-8');
}

function bindExports() {
    document.querySelectorAll('[data-export]').forEach((button) => {
        button.addEventListener('click', () => {
            if (!state.filtered) return;
            if (button.dataset.export === 'json') exportJson();
            if (button.dataset.export === 'nodes') exportNodesCsv();
            if (button.dataset.export === 'edges') exportEdgesCsv();
            if (button.dataset.export === 'svg') exportSvg();
            if (els.exportMenu) els.exportMenu.open = false;
        });
    });
}

async function initPage() {
    bindFilters();
    bindExports();

    try {
        const stored = loadStoredDataset();
        const dataset = stored || (await loadDataset());

        let analysis = null;
        try {
            analysis = await loadInteractionAnalysis();
        } catch (error) {
            console.warn('Interaction analysis artifact unavailable; using dataset fallback.', error);
        }

        state.dataset = dataset;
        state.model = buildNetworkModel(dataset, analysis);
        state.filtered = filterNetwork(state.model, state.filters);

        renderStats(state.model);
        populateFilters(state.model);
        updatePathogenUI();
        refreshClassificationMeta();
        renderSourceNote(state.model);
        setStatus('');
        view.render(dataset, state.model, state.filtered);

        if (!state.model.interactionEdges.length) {
            setStatus(
                'The loaded dataset has no resolved interaction records. Load the curated dataset or run the interaction build.'
            );
        }
    } catch (error) {
        console.error('Could not load interaction data.', error);
        setStatus(
            'Could not load the dataset. Serve the site over HTTP (for example, python -m http.server) or load a dataset on the home page first.'
        );
        if (els.networkStatus) els.networkStatus.textContent = 'Network unavailable.';
        if (els.networkSource) els.networkSource.textContent = 'No dataset loaded.';
    }
}

initPage();

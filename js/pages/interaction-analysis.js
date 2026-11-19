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
import {
  DEFAULT_DATASET_URL,
  HTTP_SETUP_HINT,
  loadDataset,
  loadStoredDataset,
} from '../data/loader.js';
import { loadInteractionAnalysis } from '../data/interaction-analysis.js';
import {
    UNCLASSIFIED,
    buildNetworkModel,
    filterNetwork,
    getFilterOptions,
} from '../analysis/network.js';
import { createNetworkView } from '../views/interaction-network.js';
import { downloadText, escapeXml, timestampSlug, toCsv } from '../utils/export.js';
import { indexById } from '../utils/collections.js';
import { formatDate, pluralize } from '../utils/format.js';
import { EVIDENCE_CLASS_LABELS } from '../utils/labels.js';

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
    unresolvedFilters: { search: '', status: '' },
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
    exportMenu: document.getElementById('ia-export'),
    unresolvedNote: document.getElementById('ia-unresolved-note'),
    unresolvedSearch: document.getElementById('ia-unresolved-search'),
    unresolvedStatus: document.getElementById('ia-unresolved-status'),
    unresolvedReset: document.getElementById('ia-unresolved-reset'),
    unresolvedBody: document.getElementById('ia-unresolved-body'),
    unresolvedCount: document.getElementById('ia-unresolved-count'),
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

function setPageStatus(message) {
    if (!els.statsStatus) return;
    els.statsStatus.textContent = message || '';
    els.statsStatus.hidden = !message;
}

function countUnique(edges, key) {
    return new Set(edges.map((edge) => edge[key]).filter(Boolean)).size;
}

function renderStats(model) {
    const stats = model.source?.kind === 'derived' ? model.source.statistics : null;
    setStat('interactions', stats?.interaction_count ?? model.interactionEdges.length);
    setStat('pathogens', stats?.unique_pathogen_count ?? countUnique(model.interactionEdges, 'pathogen_id'));
    setStat('effectors', stats?.unique_effector_count ?? countUnique(model.interactionEdges, 'source'));
    setStat('host-proteins', stats?.unique_host_protein_count ?? countUnique(model.interactionEdges, 'target'));
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
                `${pluralize(Number(unresolved), 'unresolved target')} (${pluralize(Number(unresolvedEffectors || 0), 'effector')}) excluded`
            );
        }
        if (model.source.datasetSha256) {
            pieces.push(
                `dataset SHA-256 ${model.source.datasetSha256.slice(0, 12)}... ${model.source.verified ? 'verified' : 'unverified'}`
            );
        }
        els.networkSource.textContent = pieces.join(' · ');
        return;
    }

    els.networkSource.textContent =
        'Display-only network built from dataset interactions. Run python scripts/analyze_interactions.py for validated evidence.';
}

function unresolvedRows() {
    return state.model?.source?.unresolvedTargets?.targets || [];
}

function unresolvedSearchText(row) {
    return [
        row.host_target_id,
        row.target_name,
        row.host_target_class,
        row.resolution_status,
        row.reason,
        ...(row.effector_names || []),
        ...(row.effector_ids || []),
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function visibleUnresolvedRows() {
    const query = state.unresolvedFilters.search.trim().toLowerCase();
    return unresolvedRows().filter(
        (row) =>
            (!state.unresolvedFilters.status || row.resolution_status === state.unresolvedFilters.status) &&
            (!query || unresolvedSearchText(row).includes(query))
    );
}

function populateUnresolved() {
    const rows = unresolvedRows();
    const statuses = [...new Set(rows.map((row) => row.resolution_status).filter(Boolean))].sort();
    populateSelect(
        els.unresolvedStatus,
        statuses.map((value) => ({ value, label: value })),
        'All statuses'
    );

    const summary = state.model?.source?.unresolvedTargets || {};
    const stats = state.model?.source?.statistics || {};
    const targets = summary.target_count ?? stats.unresolved_target_count ?? rows.length;
    const effectors = summary.effector_count ?? stats.unresolved_effector_count ?? 0;
    if (els.unresolvedNote) {
        els.unresolvedNote.textContent =
            state.model?.source?.kind === 'derived' && Number.isFinite(Number(targets))
                ? `${pluralize(Number(targets), 'target group')} · ${pluralize(Number(effectors), 'effector')} excluded from the network`
                : 'No excluded-target report is available for this dataset.';
    }
    renderUnresolved();
}

function renderUnresolved() {
    if (!els.unresolvedBody) return;
    const rows = unresolvedRows();
    const visible = visibleUnresolvedRows();

    els.unresolvedBody.replaceChildren();
    visible.forEach((row) => {
        const tr = document.createElement('tr');
        const cells = [
            row.target_name || String(row.host_target_id ?? 'Unknown'),
            row.resolution_status || 'unknown',
            (row.effector_names || []).join(', ') || (row.effector_ids || []).join(', '),
            row.reason || '',
        ];
        cells.forEach((value) => {
            const td = document.createElement('td');
            td.textContent = value;
            tr.appendChild(td);
        });
        els.unresolvedBody.appendChild(tr);
    });

    if (!visible.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 4;
        td.textContent = rows.length ? 'No unresolved targets match these filters.' : 'No unresolved targets reported.';
        tr.appendChild(td);
        els.unresolvedBody.appendChild(tr);
    }

    if (els.unresolvedCount) {
        els.unresolvedCount.textContent = rows.length
            ? `${visible.length} of ${rows.length} target groups shown`
            : '';
    }
}

function bindUnresolvedFilters() {
    els.unresolvedSearch?.addEventListener('input', (event) => {
        state.unresolvedFilters.search = event.target.value;
        renderUnresolved();
    });
    els.unresolvedStatus?.addEventListener('change', (event) => {
        state.unresolvedFilters.status = event.target.value;
        renderUnresolved();
    });
    els.unresolvedReset?.addEventListener('click', () => {
        state.unresolvedFilters = { search: '', status: '' };
        if (els.unresolvedSearch) els.unresolvedSearch.value = '';
        if (els.unresolvedStatus) els.unresolvedStatus.value = '';
        renderUnresolved();
    });
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
            label: EVIDENCE_CLASS_LABELS[value] || value,
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

function clearFilters() {
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

    els.reset?.addEventListener('click', clearFilters);
}

function getEvidenceFields(edge) {
    const records = edge.evidence_records || [];
    return {
        doi: [...new Set(records.map((record) => record.doi).filter(Boolean))].join('; '),
        pmid: [...new Set(records.map((record) => record.pmid).filter(Boolean))].join('; '),
        database_accession: [
            ...new Set(records.map((record) => record.database_accession).filter(Boolean)),
        ].join('; '),
    };
}

function formatActiveFilters() {
    const entries = Object.entries(state.filters).filter(([, value]) => value);
    return entries.length ? JSON.stringify(Object.fromEntries(entries)) : '';
}

function buildProvenance() {
    return {
        source_kind: state.model.source.kind,
        dataset_built_at: state.dataset?.meta?.built_at || null,
        dataset_schema_version: state.dataset?.meta?.schema_version || null,
        analysis_version: state.model.source.analysisVersion || null,
        analysis_generated_at: state.model.source.generatedAt || null,
        dataset_sha256: state.model.source.datasetSha256 || null,
        artifact_verified: Boolean(state.model.source.verified),
        classification_provenance:
            state.model.source.kind === 'derived' ? 'artifact_or_client_fallback' : 'client_heuristic',
        exported_at: new Date().toISOString(),
        filters: { ...state.filters },
        counts: state.filtered.counts,
    };
}

function downloadJson() {
    const payload = {
        schema_version: '1.0',
        ...buildProvenance(),
        nodes: state.filtered.nodes,
        interaction_edges: state.filtered.interactionEdges,
        membership_edges: state.filtered.membershipEdges,
        unresolved_targets: state.model.source?.unresolvedTargets || null,
    };

    downloadText(
        `${JSON.stringify(payload, null, 2)}\n`,
        `pathomap-network-${timestampSlug()}.json`,
        'application/json;charset=utf-8'
    );
}

function downloadNodesCsv() {
    const provenance = buildProvenance();
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
        active_filters: formatActiveFilters(),
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

function downloadEdgesCsv() {
    const provenance = buildProvenance();
    const byId = indexById(state.filtered.nodes);

    const rows = state.filtered.interactionEdges.map((edge) => {
        const effector = byId.get(edge.source);
        const host = byId.get(edge.target);
        const pathogen = byId.get(edge.pathogen_id);
        const evidence = getEvidenceFields(edge);
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
            active_filters: formatActiveFilters(),
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

function downloadUnresolvedCsv() {
    const provenance = buildProvenance();
    const rows = visibleUnresolvedRows().map((row) => ({
        host_target_id: row.host_target_id ?? '',
        target_name: row.target_name || '',
        host_target_class: row.host_target_class || '',
        resolution_status: row.resolution_status || '',
        effector_count: row.effector_count ?? (row.effector_ids || []).length,
        effector_ids: (row.effector_ids || []).join('; '),
        effector_names: (row.effector_names || []).join('; '),
        pathogen_ids: (row.pathogen_ids || []).join('; '),
        reason: row.reason || '',
        source_kind: provenance.source_kind,
        analysis_version: provenance.analysis_version,
        exported_at: provenance.exported_at,
    }));

    const columns = [
        { key: 'host_target_id', label: 'host_target_id' },
        { key: 'target_name', label: 'target_name' },
        { key: 'host_target_class', label: 'host_target_class' },
        { key: 'resolution_status', label: 'resolution_status' },
        { key: 'effector_count', label: 'effector_count' },
        { key: 'effector_ids', label: 'effector_ids' },
        { key: 'effector_names', label: 'effector_names' },
        { key: 'pathogen_ids', label: 'pathogen_ids' },
        { key: 'reason', label: 'reason' },
        { key: 'source_kind', label: 'source_kind' },
        { key: 'analysis_version', label: 'analysis_version' },
        { key: 'exported_at', label: 'exported_at' },
    ];

    downloadText(
        toCsv(columns, rows),
        `pathomap-unresolved-targets-${timestampSlug()}.csv`,
        'text/csv;charset=utf-8'
    );
}

function downloadSvg() {
    const provenance = buildProvenance();
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
            if (button.dataset.export === 'json') downloadJson();
            if (button.dataset.export === 'nodes-csv') downloadNodesCsv();
            if (button.dataset.export === 'edges-csv') downloadEdgesCsv();
            if (button.dataset.export === 'unresolved-csv') downloadUnresolvedCsv();
            if (button.dataset.export === 'svg') downloadSvg();
            if (els.exportMenu) els.exportMenu.open = false;
        });
    });
}

async function initInteractionAnalysisPage() {
    bindFilters();
    bindUnresolvedFilters();
    bindExports();

    try {
        const stored = loadStoredDataset();
        const dataset = stored || (await loadDataset(DEFAULT_DATASET_URL));

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
        populateUnresolved();
        setPageStatus('');
        view.render(dataset, state.model, state.filtered);

        if (!state.model.interactionEdges.length) {
            setPageStatus(
                'The loaded dataset has no resolved interaction records. Load the curated dataset or run the interaction build.'
            );
        }
    } catch (error) {
        console.error('Could not load interaction data.', error);
        setPageStatus(
            `Could not load the dataset. ${HTTP_SETUP_HINT} Or load a dataset on the home page first.`
        );
        if (els.networkStatus) els.networkStatus.textContent = 'Network unavailable.';
        if (els.networkSource) els.networkSource.textContent = 'No dataset loaded.';
    }
}

initInteractionAnalysisPage();

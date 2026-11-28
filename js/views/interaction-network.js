/*
  interaction-network.js - Force-directed SVG network view and details panel.

  The view renders pathogens, effectors, and host proteins as an organic
  network, handles selection/focus, zoom/pan/fit, and builds the serialized
  SVG used by exports. Scientific joins and filtering live in
  js/analysis/network.js; layout helpers in ./network-layout.js and physics
  in ./network-physics.js.
*/

import {
    NODE_TYPE_LABELS,
    buildEdgeDetail,
    buildNodeDetail,
} from '../analysis/network.js';
import { createLink } from '../utils/dom.js';
import { pluralize } from '../utils/format.js';
import { evidenceClassLabel } from '../utils/labels.js';
import { createNetworkLayout } from './network-physics.js';
import {
    edgeCurvature,
    edgePath,
    fitTransform,
    graphWorldSize,
    networkZoomRange,
    seedOrganicPositions,
    selectVisibleLabels,
    sharedHostPathogens,
} from './network-layout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_RADIUS = 9;
const PAN_THRESHOLD = 4;
const PAN_LIMIT_X = 280;
const PAN_LIMIT_Y = 220;
const PAN_CAP_SCALE = 0.576;
const PROGRESSIVE_BATCH = 80;
const LARGE_GRAPH_NODES = 180;
const LARGE_GRAPH_TICK_LIMIT = 120;
const LABEL_TIERS = { essential: 0, primary: 1, secondary: 2, minor: 3 };
const FALLBACK_LABEL_WIDTH = 6.1;
const FALLBACK_LABEL_HEIGHT = 13;

function createSvgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => {
        if (value !== null && value !== undefined) element.setAttribute(key, value);
    });
    return element;
}

function createElement(tag, className = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
}

function shortLabel(node) {
    const value = String(
        node.type === 'host_protein' ? node.gene_name || node.label : node.label || node.id
    );
    const limit = node.type === 'pathogen' ? 28 : node.type === 'host_protein' ? 22 : 24;
    return value.length > limit ? `${value.slice(0, limit - 1)}...` : value;
}

function labelRadiusFromWidth(width) {
    return Math.min(140, Math.max(20, width / 2 + 6));
}

function labelPriority(node, degree = 0, flags = {}) {
    let priority = Math.min(24, degree) * 0.7;
    if (node.type === 'pathogen') priority += 16;
    if (node.type === 'host_protein') priority += 18;
    if (node.type === 'host_target') priority += 8;
    if (node.type === 'effector') priority += 1;
    if (flags.shared > 1) priority += 12;
    if (flags.connected) priority += 80;
    if (flags.selected) priority += 200;
    return priority;
}

function labelTier(node, degree = 0, flags = {}) {
    if (flags.selected || flags.connected) return 'essential';
    if (
        node.type === 'pathogen' ||
        node.type === 'host_protein' ||
        flags.shared > 1 ||
        degree >= 5
    ) {
        return 'primary';
    }
    if (node.type === 'host_target' || degree >= 2) return 'secondary';
    return 'minor';
}

function getEdgeClass(edge) {
    return edge.strongest_evidence_class || 'none';
}

function connectedSelection(model, selected) {
    const nodes = new Set();
    const interactionEdges = new Set();
    const membershipEdges = new Set();
    if (!selected) return { nodes, interactionEdges, membershipEdges };

    if (selected.kind === 'node') {
        nodes.add(selected.id);
        model.interactionEdges.forEach((edge) => {
            if (
                edge.source === selected.id ||
                edge.target === selected.id ||
                edge.pathogen_id === selected.id
            ) {
                interactionEdges.add(edge.id);
                nodes.add(edge.source);
                nodes.add(edge.target);
                if (edge.pathogen_id) nodes.add(edge.pathogen_id);
            }
        });
        model.membershipEdges.forEach((edge) => {
            if (edge.source === selected.id || edge.target === selected.id) {
                membershipEdges.add(edge.id);
                nodes.add(edge.source);
                nodes.add(edge.target);
            }
        });
    } else if (selected.kind === 'edge') {
        const edge = model.interactionEdges.find((item) => item.id === selected.id);
        if (!edge) return { nodes, interactionEdges, membershipEdges };
        interactionEdges.add(edge.id);
        nodes.add(edge.source);
        nodes.add(edge.target);
        if (edge.pathogen_id) nodes.add(edge.pathogen_id);
    }

    model.membershipEdges.forEach((edge) => {
        if (membershipEdges.has(edge.id)) return;
        if (nodes.has(edge.source) || nodes.has(edge.target)) {
            membershipEdges.add(edge.id);
            nodes.add(edge.source);
            nodes.add(edge.target);
        }
    });

    return { nodes, interactionEdges, membershipEdges };
}

function getCssColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

export function createNetworkView({
    canvas,
    details,
    empty,
    status,
    controls,
}) {
    let dataset = null;
    let model = null;
    let filtered = null;
    let selected = null;
    let svg = null;
    let viewport = null;
    let transform = { zoom: 1, x: 0, y: 0 };
    let zoomRange = { minZoom: 0.08, maxZoom: 8 };
    let panOrigin = { x: 0, y: 0 };
    let contentSize = { width: 1000, height: 700 };
    let gesture = null;
    let resizeTimer = null;
    let resizeObserver = null;
    let renderKey = null;
    let layout = null;
    let sharedHosts = new Map();
    let animationFrame = null;
    let animationTicks = 0;
    let nodeElements = new Map();
    let nodeRecords = [];
    let labelRecords = [];
    let edgeRecords = [];
    let membershipRecords = [];
    let edgePaths = [];
    let nodeEdges = new Map();
    let nodeDegree = new Map();
    let labelMetricCache = new Map();
    let labelFrame = null;
    let suppressClick = false;
    let progressiveTasks = [];
    let progressiveFrame = null;
    let progressiveToken = 0;
    let visibleLabelIds = new Set();
    let detailsToggle = null;
    let selectionKey = null;
    let lastTransformKey = '';
    let labelRefreshKey = null;
    let labelGeometryVersion = 0;

    function setNetworkStatus(message) {
        if (!status) return;
        status.textContent = message || '';
    }

    function getDetailContainer() {
        if (!details) return null;
        let body = details.querySelector('.ia-detail-body');
        if (!body) {
            details.replaceChildren();
            body = createElement('div', 'ia-detail-body');
            details.appendChild(body);
        }
        return body;
    }

    function cancelProgressive() {
        progressiveToken += 1;
        if (progressiveFrame !== null) cancelAnimationFrame(progressiveFrame);
        progressiveFrame = null;
        progressiveTasks = [];
    }

    function measureLabel(element, node) {
        const key = `${node.type}|${shortLabel(node)}`;
        if (labelMetricCache.has(key)) return labelMetricCache.get(key);
        const text = shortLabel(node);
        let metrics = {
            width: text.length * FALLBACK_LABEL_WIDTH,
            height: FALLBACK_LABEL_HEIGHT,
            dx: (-text.length * FALLBACK_LABEL_WIDTH) / 2,
            dy: NODE_RADIUS + 6,
        };
        try {
            if (typeof element.getBBox === 'function') {
                const box = element.getBBox();
                if (box && Number.isFinite(box.width) && box.width > 0) {
                    metrics = {
                        width: box.width,
                        height: Number.isFinite(box.height) && box.height > 0 ? box.height : FALLBACK_LABEL_HEIGHT,
                        dx: Number.isFinite(box.x) ? box.x : -box.width / 2,
                        dy: Number.isFinite(box.y) ? box.y : NODE_RADIUS + 6,
                    };
                }
            }
            if (metrics.width <= 0 && typeof element.getComputedTextLength === 'function') {
                const width = element.getComputedTextLength();
                if (Number.isFinite(width) && width > 0) {
                    metrics = {
                        width,
                        height: FALLBACK_LABEL_HEIGHT,
                        dx: -width / 2,
                        dy: NODE_RADIUS + 6,
                    };
                }
            }
        } catch (error) {
            // Detached/headless SVG implementations may not support metrics.
        }
        labelMetricCache.set(key, metrics);
        return metrics;
    }

    function measureNewLabels() {
        for (const record of labelRecords) {
            if (!record.metrics) record.metrics = measureLabel(record.element, record.node);
        }
    }

    function refreshLabels(force = false) {
        if (!svg || !layout || !filtered) return;
        const effectiveFont = 11 * transform.zoom;
        const maxTier =
            effectiveFont < 6
                ? 'primary'
                : effectiveFont < 8.5
                  ? 'primary'
                  : effectiveFont < 11
                    ? 'secondary'
                    : 'minor';
        // At overview scale keep only a few anchor labels so the graph stays
        // interpretable without becoming a wall of text.
        const candidateLimit = effectiveFont < 6 ? 20 : Infinity;
        // Translation and uniform scaling do not change which label rectangles
        // overlap. Recompute only when the tier, selection, or node geometry
        // actually changes, so wheel zoom and pan stay cheap.
        const nextKey = [
            maxTier,
            candidateLimit,
            selected?.kind || '',
            selected?.id || '',
            labelRecords.length,
            labelGeometryVersion,
        ].join('|');
        if (!force && nextKey === labelRefreshKey) return;
        labelRefreshKey = nextKey;

        const connected = connectedSelection(filtered, selected);
        const candidates = [];

        for (const record of labelRecords) {
            const body = layout.get(record.node.id);
            if (!body || !record.metrics) continue;
            const { dx, dy, width, height } = record.metrics;
            const shared = sharedHosts.get(record.node.id)?.size || 0;
            const isConnected = connected.nodes.has(record.node.id);
            const isSelected = selected?.kind === 'node' && selected.id === record.node.id;
            const tier = labelTier(record.node, nodeDegree.get(record.node.id) || 0, {
                shared,
                connected: isConnected,
                selected: isSelected,
            });
            if (LABEL_TIERS[tier] > LABEL_TIERS[maxTier]) {
                if (!record.hidden) {
                    record.element.classList.add('is-label-hidden');
                    record.hidden = true;
                }
                continue;
            }
            candidates.push({
                id: record.node.id,
                priority:
                    labelPriority(record.node, nodeDegree.get(record.node.id) || 0, {
                        shared,
                        connected: connected.nodes.has(record.node.id),
                        selected: isSelected,
                    }) + (visibleLabelIds.has(record.node.id) ? 30 : 0),
                rect: {
                    x: (body.x + dx) * transform.zoom + transform.x,
                    y: (body.y + dy) * transform.zoom + transform.y,
                    width: width * transform.zoom,
                    height: height * transform.zoom,
                },
            });
        }

        candidates.sort((first, second) => second.priority - first.priority);
        const visible = selectVisibleLabels(
            Number.isFinite(candidateLimit) ? candidates.slice(0, candidateLimit) : candidates,
            contentSize,
            { margin: 2, cellSize: 96 }
        );
        // The selected node is always labelled, even if it sits just outside
        // the viewport after a drag or zoom.
        if (selected?.kind === 'node') visible.add(selected.id);
        visibleLabelIds = new Set(visible);
        for (const record of labelRecords) {
            const hidden = !visible.has(record.node.id);
            if (hidden !== record.hidden) {
                record.element.classList.toggle('is-label-hidden', hidden);
                record.hidden = hidden;
            }
        }
    }

    function scheduleLabels() {
        if (labelFrame !== null) return;
        labelFrame = requestAnimationFrame(() => {
            labelFrame = null;
            refreshLabels();
        });
    }

    function startProgressive() {
        const token = ++progressiveToken;
        const step = () => {
            progressiveFrame = null;
            if (token !== progressiveToken || !svg) return;
            const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
            let processed = 0;
            while (
                progressiveTasks.length &&
                processed < PROGRESSIVE_BATCH &&
                (typeof performance === 'undefined' ? Date.now() : performance.now()) - started < 10
            ) {
                progressiveTasks.shift()();
                processed += 1;
            }
            measureNewLabels();
            updatePositions();
            applySelection(true);
            if (progressiveTasks.length) {
                progressiveFrame = requestAnimationFrame(step);
            } else {
                // Keep the graph still until every node and edge exists;
                // otherwise the viewport and labels jump while batches land.
                startAnimation();
            }
        };
        progressiveFrame = requestAnimationFrame(step);
    }

    function flushProgressive({ resume = true } = {}) {
        if (!progressiveTasks.length && progressiveFrame === null) return;
        if (progressiveFrame !== null) cancelAnimationFrame(progressiveFrame);
        progressiveFrame = null;
        progressiveToken += 1;
        while (progressiveTasks.length) progressiveTasks.shift()();
        measureNewLabels();
        updatePositions();
        applySelection(true);
        if (resume) startAnimation();
    }

    function toggleDetails(force) {
        if (!details) return;
        const host = details.closest?.('.ia-network-layout');
        const collapsed =
            typeof force === 'boolean'
                ? force
                : !(host?.classList.contains('is-details-collapsed') || details.classList.contains('is-details-collapsed'));
        host?.classList.toggle('is-details-collapsed', collapsed);
        details.classList.toggle('is-details-collapsed', collapsed);
        details.hidden = collapsed;
        if (detailsToggle) {
            detailsToggle.setAttribute('aria-expanded', String(!collapsed));
            detailsToggle.setAttribute('aria-label', collapsed ? 'Show details panel' : 'Hide details panel');
            detailsToggle.setAttribute('title', collapsed ? 'Show details panel' : 'Hide details panel');
            detailsToggle.textContent = collapsed ? 'Details' : 'Hide details';
        }
    }

    function renderEmptyDetail() {
        const body = getDetailContainer();
        if (!body) return;
        body.replaceChildren();
        const container = createElement('div', 'ia-detail-empty');
        const title = createElement('p', 'ia-detail-empty-title');
        title.textContent = 'Select a node or interaction';
        const text = createElement('p', 'ia-muted');
        text.textContent =
            'Click a pathogen, effector, host protein, annotated target, or link to inspect its biology and evidence.';
        container.append(title, text);
        body.appendChild(container);
    }

    function createFieldList(parent, fields) {
        if (!fields.length) return;
        const dl = createElement('dl', 'ia-detail-fields');
        fields.forEach((item) => {
            const dt = createElement('dt');
            const dd = createElement('dd');
            dt.textContent = item.label;
            if (item.href) {
                dd.appendChild(createLink(item.href, item.value, ''));
            } else {
                dd.textContent = String(item.value);
            }
            dl.append(dt, dd);
        });
        parent.appendChild(dl);
    }

    function createParagraphs(parent, paragraphs) {
        paragraphs.forEach((item) => {
            const block = createElement('div', 'ia-detail-paragraph');
            const heading = createElement('p', 'ia-detail-section-label');
            const text = createElement('p');
            heading.textContent = item.label;
            text.textContent = item.text;
            block.append(heading, text);
            parent.appendChild(block);
        });
    }

    function createList(parent, label, items) {
        if (!items.length) return;
        const block = createElement('div', 'ia-detail-block');
        const heading = createElement('p', 'ia-detail-section-label');
        const list = createElement('ul', 'ia-detail-list');
        heading.textContent = label;
        items.forEach((item) => {
            const li = createElement('li');
            if (item.href) {
                li.appendChild(createLink(item.href, item.text, ''));
            } else {
                li.textContent = item.text;
            }
            list.appendChild(li);
        });
        block.append(heading, list);
        parent.appendChild(block);
    }

    function createRelatedList(parent, related) {
        if (!related.length) return;
        const block = createElement('div', 'ia-detail-block');
        const heading = createElement('p', 'ia-detail-section-label');
        const chips = createElement('div', 'ia-detail-chips');
        heading.textContent = 'Connected entities';
        related.forEach((item) => {
            const button = createElement('button', 'ia-detail-chip');
            button.type = 'button';
            button.dataset.relatedId = item.id;
            button.title = `${NODE_TYPE_LABELS[item.type] || item.type}: ${item.label}`;
            button.textContent = item.detail ? `${item.label} (${item.detail})` : item.label;
            chips.appendChild(button);
        });
        block.append(heading, chips);
        parent.appendChild(block);
    }

    function createEvidenceList(parent, evidence) {
        if (!evidence.length) return;
        const block = createElement('div', 'ia-detail-block');
        const heading = createElement('p', 'ia-detail-section-label');
        heading.textContent = 'Evidence records';
        const list = createElement('div', 'ia-evidence-list');

        evidence.forEach((record) => {
            const card = createElement('article', 'ia-evidence-card');
            const classRow = createElement('div', 'ia-evidence-card-head');
            const badge = createElement(
                'span',
                `ia-evidence-badge ia-evidence-badge--${record.evidence_class || 'hypothetical'}`
            );
            badge.textContent = evidenceClassLabel(record.evidence_class);
            classRow.appendChild(badge);
            if (record.evidence_id) {
                const id = createElement('span', 'ia-muted');
                id.textContent = record.evidence_id;
                classRow.appendChild(id);
            }
            card.appendChild(classRow);

            const links = [];
            if (record.doi) {
                links.push({ label: `DOI ${record.doi}`, href: `https://doi.org/${record.doi}` });
            }
            if (record.pmid) {
                links.push({
                    label: `PubMed ${record.pmid}`,
                    href: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(record.pmid)}/`,
                });
            }
            if (record.database_accession) {
                links.push({ label: `Accession ${record.database_accession}`, href: null });
            }

            if (links.length) {
                const linkList = createElement('ul', 'ia-detail-list');
                links.forEach((item) => {
                    const li = createElement('li');
                    if (item.href) {
                        const link = createElement('a');
                        link.href = item.href;
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                        link.textContent = item.label;
                        li.appendChild(link);
                    } else {
                        li.textContent = item.label;
                    }
                    linkList.appendChild(li);
                });
                card.appendChild(linkList);
            }

            if (record.note) {
                const note = createElement('p', 'ia-evidence-note');
                note.textContent = record.note;
                card.appendChild(note);
            }
            if (record.provenance) {
                const provenance = createElement('p', 'ia-muted ia-evidence-provenance');
                provenance.textContent = record.provenance;
                card.appendChild(provenance);
            }
            list.appendChild(card);
        });

        block.append(heading, list);
        parent.appendChild(block);
    }

    function renderDetail(detail) {
        const body = getDetailContainer();
        if (!body) return;
        body.replaceChildren();

        if (!detail) {
            renderEmptyDetail();
            return;
        }

        const header = createElement('div', 'ia-detail-header');
        const badge = createElement(
            'span',
            detail.kind === 'edge' ? 'ia-detail-badge ia-detail-badge--edge' : `ia-detail-badge ia-detail-badge--${detail.type}`
        );
        badge.textContent = detail.kind === 'edge' ? 'Interaction' : detail.typeLabel;
        const title = createElement('h4', 'ia-detail-title');
        title.textContent = detail.title;
        header.append(badge, title);
        if (detail.subtitle) {
            const subtitle = createElement('p', 'ia-detail-subtitle');
            subtitle.textContent = detail.subtitle;
            header.appendChild(subtitle);
        }
        if (detail.id) {
            const id = createElement('code', 'ia-detail-id');
            id.textContent = detail.id;
            header.appendChild(id);
        }
        body.appendChild(header);

        createFieldList(body, detail.fields);
        createParagraphs(body, detail.paragraphs);
        detail.lists.forEach((item) => createList(body, item.label, item.items));
        createEvidenceList(body, detail.evidence);
        createRelatedList(body, detail.related);

        if (detail.externalLinks?.length) {
            const block = createElement('div', 'ia-detail-block');
            const heading = createElement('p', 'ia-detail-section-label');
            const list = createElement('ul', 'ia-detail-list');
            heading.textContent = 'External records';
            detail.externalLinks.forEach((item) => {
                const li = createElement('li');
                const link = createElement('a');
                link.href = item.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = item.label;
                li.appendChild(link);
                list.appendChild(li);
            });
            block.append(heading, list);
            body.appendChild(block);
        }

        const clear = createElement('button', 'tool-btn tool-btn-sm ia-detail-clear');
        clear.type = 'button';
        clear.textContent = 'Clear selection';
        clear.addEventListener('click', clearSelection);
        body.appendChild(clear);
    }

    function applySelection(force = false) {
        if (!svg) return;
        const signature = selected ? `${selected.kind}:${selected.id}` : 'none';
        if (!force && signature === selectionKey) return;
        selectionKey = signature;

        const source = filtered || { interactionEdges: [], membershipEdges: [] };
        const connected = connectedSelection(source, selected);

        for (const record of nodeRecords) {
            const isRelevant = !selected || connected.nodes.has(record.id);
            record.element.classList.toggle('is-dimmed', !isRelevant);
            record.element.classList.toggle('is-connected', Boolean(selected) && connected.nodes.has(record.id));
            record.element.classList.toggle('is-selected', selected?.kind === 'node' && selected.id === record.id);
        }

        for (const record of edgeRecords) {
            const relevant = !selected || connected.interactionEdges.has(record.id);
            record.path.classList.toggle('is-dimmed', !relevant);
            record.path.classList.toggle(
                'is-connected',
                Boolean(selected) && relevant && selected?.kind !== 'edge'
            );
            record.path.classList.toggle('is-selected', selected?.kind === 'edge' && selected.id === record.id);
        }

        for (const record of membershipRecords) {
            const relevant = !selected || connected.membershipEdges.has(record.id);
            record.path.classList.toggle('is-dimmed', !relevant);
            record.path.classList.toggle('is-connected', Boolean(selected) && relevant);
        }

        refreshLabels(force);
    }

    function selectNode(nodeId, focusDetails = true) {
        if (!filtered?.nodes.some((node) => node.id === nodeId)) return;
        selected = { kind: 'node', id: nodeId };
        applySelection();
        renderDetail(buildNodeDetail(dataset, filtered, nodeId));
        if (focusDetails && details) details.scrollTop = 0;
    }

    function selectEdge(edgeId) {
        if (!filtered?.interactionEdges.some((edge) => edge.id === edgeId)) return;
        selected = { kind: 'edge', id: edgeId };
        applySelection();
        renderDetail(buildEdgeDetail(dataset, filtered, edgeId));
        if (details) details.scrollTop = 0;
    }

    function clearSelection() {
        selected = null;
        applySelection();
        renderEmptyDetail();
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function clampTransform() {
        const limitX = Math.min(PAN_LIMIT_X, Math.max(120, contentSize.width * 0.28)) * PAN_CAP_SCALE;
        const limitY = Math.min(PAN_LIMIT_Y, Math.max(90, contentSize.height * 0.24)) * PAN_CAP_SCALE;
        transform.x = clamp(transform.x, panOrigin.x - limitX, panOrigin.x + limitX);
        transform.y = clamp(transform.y, panOrigin.y - limitY, panOrigin.y + limitY);
    }

    function clearPointerFocus() {
        const active = document.activeElement;
        if (active && active !== canvas && canvas?.contains?.(active)) {
            active.blur?.();
        }
    }

    function blurIfFocused(element) {
        if (element && document.activeElement === element) element.blur?.();
    }

    function applyTransform() {
        if (!viewport) return;
        const next = `translate(${transform.x.toFixed(3)} ${transform.y.toFixed(3)}) scale(${transform.zoom.toFixed(4)})`;
        if (next === lastTransformKey) return;
        lastTransformKey = next;
        viewport.setAttribute('transform', next);
        scheduleLabels();
    }

    function zoomBy(factor, anchor = null) {
        const nextZoom = clamp(transform.zoom * factor, zoomRange.minZoom, zoomRange.maxZoom);
        if (nextZoom === transform.zoom) return;
        // Anchor in SVG user space: screen = translate + zoom * graph.
        // Keeping the translate untouched by pan bounds here makes the
        // transform exactly reversible, so zoom in/out cycles cannot drift.
        const anchorX = anchor?.x ?? contentSize.width / 2;
        const anchorY = anchor?.y ?? contentSize.height / 2;
        const ratio = nextZoom / transform.zoom;
        transform.x = anchorX - (anchorX - transform.x) * ratio;
        transform.y = anchorY - (anchorY - transform.y) * ratio;
        transform.zoom = nextZoom;
        // Anchored zoom moves the translate far from the old pan window. Rebase
        // it here, otherwise the next pan snaps back into the stale bounds.
        panOrigin = { x: transform.x, y: transform.y };
        applyTransform();
    }

    function fitToScreen() {
        if (!layout) return;
        zoomRange = networkZoomRange(layout.bodies, contentSize.width, contentSize.height, 26);
        transform = fitTransform(layout.bodies, contentSize.width, contentSize.height, 26, {
            minZoom: zoomRange.minZoom,
        });
        panOrigin = { x: transform.x, y: transform.y };
        applyTransform();
    }

    function resetNetworkView() {
        layout?.reset();
        updatePositions();
        fitToScreen();
        if (!progressiveTasks.length && progressiveFrame === null) startAnimation();
    }

    function renderNetworkStatus() {
        const counts = filtered?.counts;
        if (!counts) return;
        const countText = [
            pluralize(counts.interactions, 'interaction'),
            pluralize(counts.targetAssociations || 0, 'annotated target link'),
            pluralize(counts.effectors, 'effector'),
            pluralize(counts.hostProteins, 'host protein'),
            pluralize(counts.annotatedTargets || 0, 'annotated target'),
            pluralize(counts.pathogens, 'pathogen'),
        ].join(' · ');
        setNetworkStatus(countText);
    }

    function renderCurrentDetail() {
        if (selected?.kind === 'node') {
            renderDetail(buildNodeDetail(dataset, filtered, selected.id));
        } else if (selected?.kind === 'edge') {
            renderDetail(buildEdgeDetail(dataset, filtered, selected.id));
        } else {
            renderEmptyDetail();
        }
    }

    function renderGraph() {
        if (!canvas) return;
        const viewportWidth = Math.max(
            1,
            Math.round(canvas.clientWidth || canvas.getBoundingClientRect?.().width || 800)
        );
        const viewportHeight = Math.max(
            1,
            Math.round(canvas.clientHeight || canvas.getBoundingClientRect?.().height || 560)
        );
        const nextKey = [
            viewportWidth,
            viewportHeight,
            model?.source?.datasetSha256 || model?.source?.datasetBuiltAt || dataset?.meta?.built_at || '',
            (filtered?.nodes || []).map((node) => `${node.id}:${node.label}`).join(','),
            (filtered?.interactionEdges || [])
                .map((edge) => `${edge.id}:${edge.strongest_evidence_class || ''}`)
                .join(','),
            (filtered?.membershipEdges || []).map((edge) => edge.id).join(','),
        ].join('|');
        const visibleNodeIds = new Set((filtered?.nodes || []).map((node) => node.id));
        const visibleEdgeIds = new Set((filtered?.interactionEdges || []).map((edge) => edge.id));
        const selectionMissing =
            selected &&
            ((selected.kind === 'node' && !visibleNodeIds.has(selected.id)) ||
                (selected.kind === 'edge' && !visibleEdgeIds.has(selected.id)));
        if (selectionMissing) {
            selected = null;
        }

        const hasInteractions = Boolean(filtered?.interactionEdges.length);
        if (canvas) canvas.hidden = !hasInteractions;
        if (empty) empty.hidden = hasInteractions;
        if (!hasInteractions) {
            stopAnimation();
            cancelProgressive();
            if (labelFrame !== null) cancelAnimationFrame(labelFrame);
            labelFrame = null;
            layout = null;
            sharedHosts = new Map();
            gesture = null;
            suppressClick = false;
            renderKey = null;
            selectionKey = null;
            lastTransformKey = '';
            nodeElements = new Map();
            nodeRecords = [];
            labelRecords = [];
            edgeRecords = [];
            membershipRecords = [];
            edgePaths = [];
            svg = null;
            viewport = null;
            canvas.replaceChildren();
            if (selected) {
                selected = null;
            }
            renderEmptyDetail();
            setNetworkStatus('No interactions match the active filters.');
            return;
        }

        if (svg && nextKey === renderKey) {
            applyTransform();
            applySelection();
            renderNetworkStatus();
            return;
        }

        stopAnimation();
        cancelProgressive();
        layout = null;
        gesture = null;
        nodeElements = new Map();
        nodeRecords = [];
        labelRecords = [];
        edgeRecords = [];
        membershipRecords = [];
        edgePaths = [];
        nodeEdges = new Map();
        nodeDegree = new Map();
        suppressClick = false;
        selectionKey = null;
        lastTransformKey = '';
        labelRefreshKey = null;
        renderKey = nextKey;
        canvas.replaceChildren();
        svg = null;
        viewport = null;

        const width = viewportWidth;
        const height = viewportHeight;
        contentSize = { width, height };
        const world = graphWorldSize(filtered.nodes.length, width, height);

        svg = createSvgElement('svg', {
            class: 'ia-network-svg',
            viewBox: `0 0 ${width} ${height}`,
            role: 'group',
            'aria-label': 'Force-directed network of pathogens, effectors, host proteins, and annotated targets',
        });
        svg.appendChild(createSvgElement('title')).textContent =
            'Pathogen, effector, host protein, and annotated target network';

        const background = createSvgElement('rect', {
            x: 0,
            y: 0,
            width,
            height,
            class: 'ia-network-background',
        });
        svg.appendChild(background);

        const defs = createSvgElement('defs');
        const marker = createSvgElement('marker', {
            id: 'ia-arrow',
            viewBox: '0 0 10 10',
            refX: '9',
            refY: '5',
            markerWidth: '6',
            markerHeight: '6',
            orient: 'auto-start-reverse',
        });
        marker.appendChild(createSvgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'ia-arrow-head' }));
        defs.appendChild(marker);
        svg.appendChild(defs);

        viewport = createSvgElement('g', { class: 'ia-viewport' });
        svg.appendChild(viewport);
        canvas.appendChild(svg);

        // Measure label text once, while attached, so layout spacing and the
        // initial fit use real dimensions instead of a character heuristic.
        const measureProbe = createSvgElement('text', {
            'text-anchor': 'middle',
            x: 0,
            y: NODE_RADIUS + 16,
            visibility: 'hidden',
        });
        svg.appendChild(measureProbe);
        filtered.nodes.forEach((node) => {
            measureProbe.setAttribute('class', `ia-node-label ia-node-label--${node.type}`);
            measureProbe.textContent = shortLabel(node);
            measureLabel(measureProbe, node);
        });
        measureProbe.remove();

        sharedHosts = sharedHostPathogens(filtered.interactionEdges);
        const links = [
            ...filtered.membershipEdges.map((edge) => ({
                source: edge.source,
                target: edge.target,
                kind: 'membership',
            })),
            ...filtered.interactionEdges.map((edge) => ({
                source: edge.source,
                target: edge.target,
                kind: 'interaction',
            })),
        ];
        nodeDegree = new Map(filtered.nodes.map((node) => [node.id, 0]));
        links.forEach((link) => {
            const source = link.source?.id ?? link.source;
            const target = link.target?.id ?? link.target;
            if (nodeDegree.has(source)) nodeDegree.set(source, nodeDegree.get(source) + 1);
            if (nodeDegree.has(target)) nodeDegree.set(target, nodeDegree.get(target) + 1);
        });
        const layoutNodes = filtered.nodes.map((node) => {
            const metrics = labelMetricCache.get(`${node.type}|${shortLabel(node)}`);
            return {
                ...node,
                labelRadius: labelRadiusFromWidth(metrics.width),
                labelHalfWidth: metrics.width / 2,
                labelHalfHeight: metrics.height,
            };
        });
        seedOrganicPositions(layoutNodes, world.width, world.height, links);
        layout = createNetworkLayout({
            nodes: layoutNodes,
            links,
            width: world.width,
            height: world.height,
            radius: NODE_RADIUS + 4,
            top: 56,
            bottom: world.height - 56,
        });
        const positions = new Map(layout.bodies.map((body) => [body.id, body]));

        const edgeLayer = createSvgElement('g', { class: 'ia-edge-layer' });
        const hitLayer = createSvgElement('g', { class: 'ia-edge-hits' });
        viewport.append(edgeLayer, hitLayer);

        filtered.membershipEdges.forEach((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) return;
            const d = edgePath(source, target);
            const path = createSvgElement('path', {
                d,
                class: 'ia-edge ia-edge--membership',
                'data-membership-id': edge.id,
                'marker-end': 'url(#ia-arrow)',
            });
            progressiveTasks.push(() => edgeLayer.appendChild(path));
            edgePaths.push({ path, sourceId: edge.source, targetId: edge.target, curvature: 0 });
            membershipRecords.push({ id: edge.id, path });
        });

        filtered.interactionEdges.forEach((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) return;
            const curvature = edgeCurvature(edge.id || `${edge.source}:${edge.target}`);
            const d = edgePath(source, target, curvature);
            const sharedCount = sharedHosts.get(edge.target)?.size || 0;
            const path = createSvgElement('path', {
                d,
                class: `ia-edge ia-edge--interaction ia-edge--${getEdgeClass(edge)}`,
                'data-edge-id': edge.id,
            });
            progressiveTasks.push(() => edgeLayer.appendChild(path));

            const hit = createSvgElement('path', {
                d,
                class: 'ia-edge-hit',
                'data-edge-id': edge.id,
                tabindex: '0',
                role: 'button',
                'aria-label':
                    `Interaction ${edge.id}: ${source.label} targets ${target.label}` +
                    (sharedCount > 1 ? ` (shared by ${sharedCount} pathogens)` : ''),
            });
            progressiveTasks.push(() => hitLayer.appendChild(hit));
            edgePaths.push({
                path,
                hit,
                sourceId: edge.source,
                targetId: edge.target,
                curvature,
            });
            edgeRecords.push({ id: edge.id, path, hit });
        });

        // Dragging one node should update only its incident edges, not all 492.
        nodeEdges = new Map(filtered.nodes.map((node) => [node.id, []]));
        edgePaths.forEach((entry) => {
            nodeEdges.get(entry.sourceId)?.push(entry);
            nodeEdges.get(entry.targetId)?.push(entry);
        });

        const nodeLayer = createSvgElement('g', { class: 'ia-node-layer' });
        viewport.appendChild(nodeLayer);

        filtered.nodes.forEach((node) => {
            const position = positions.get(node.id);
            if (!position) return;
            const sharedPathogens = sharedHosts.get(node.id)?.size || 0;
            const sharedNote = sharedPathogens > 1 ? `, shared target of ${sharedPathogens} pathogens` : '';

            const group = createSvgElement('g', {
                class: `ia-node ia-node--${node.type}${sharedPathogens > 1 ? ' is-shared-host' : ''}`,
                transform: `translate(${position.x} ${position.y})`,
                'data-node-id': node.id,
                'data-shared-pathogens': sharedPathogens || null,
                tabindex: '0',
                role: 'button',
                'aria-label': `${NODE_TYPE_LABELS[node.type]}: ${node.label}${sharedNote}`,
            });

            if (sharedPathogens > 1) {
                group.appendChild(
                    createSvgElement('circle', {
                        r: NODE_RADIUS + 7,
                        class: 'ia-shared-host-ring',
                    })
                );
            }

            let shape;
            if (node.type === 'pathogen') {
                const points = [];
                for (let index = 0; index < 6; index += 1) {
                    const angle = (Math.PI / 3) * index - Math.PI / 2;
                    points.push(
                        `${(NODE_RADIUS + 2) * Math.cos(angle)},${(NODE_RADIUS + 2) * Math.sin(angle)}`
                    );
                }
                shape = createSvgElement('polygon', { points: points.join(' '), class: 'ia-node-shape' });
            } else if (node.type === 'effector') {
                shape = createSvgElement('circle', { r: NODE_RADIUS, class: 'ia-node-shape' });
            } else if (node.type === 'host_target') {
                shape = createSvgElement('rect', {
                    x: -NODE_RADIUS + 2,
                    y: -NODE_RADIUS + 2,
                    width: NODE_RADIUS * 2 - 4,
                    height: NODE_RADIUS * 2 - 4,
                    rx: 10,
                    class: 'ia-node-shape',
                });
            } else {
                shape = createSvgElement('rect', {
                    x: -NODE_RADIUS,
                    y: -NODE_RADIUS + 2,
                    width: NODE_RADIUS * 2,
                    height: NODE_RADIUS * 2 - 4,
                    rx: 3,
                    class: 'ia-node-shape',
                });
            }
            group.appendChild(shape);

            const title = createSvgElement('title');
            title.textContent = `${NODE_TYPE_LABELS[node.type]}: ${node.label}${sharedNote}`;
            group.appendChild(title);

            const label = createSvgElement('text', {
                class: `ia-node-label ia-node-label--${node.type} is-label-hidden`,
                x: 0,
                y: NODE_RADIUS + 16,
                'text-anchor': 'middle',
            });
            label.textContent = shortLabel(node);
            group.appendChild(label);

            // Nodes land before their edges so the graph never appears as a
            // web of lines waiting for endpoints.
            progressiveTasks.unshift(() => nodeLayer.appendChild(group));
            nodeElements.set(node.id, group);
            nodeRecords.push({ id: node.id, element: group });
            labelRecords.push({
                id: node.id,
                node,
                element: label,
                metrics: null,
                hidden: true,
                tier: labelTier(node, nodeDegree.get(node.id) || 0, {
                    shared: sharedPathogens,
                }),
            });
        });

        layout.reheat(0.55);
        visibleLabelIds = new Set();
        fitToScreen();
        applySelection(true);
        renderNetworkStatus();
        renderCurrentDetail();
        startProgressive();
    }

    /**
     * Map client pixels into SVG user space. A rect-derived mapping avoids the
     * getScreenCTM()/SVGPoint allocations that made wheel and drag events slow.
     */
    function clientToSvg(event, rect = null) {
        if (!svg) return { x: 0, y: 0 };
        const box =
            rect ||
            (typeof svg.getBoundingClientRect === 'function' ? svg.getBoundingClientRect() : null);
        if (box && box.width && box.height) {
            return {
                x: ((event.clientX - box.left) * contentSize.width) / box.width,
                y: ((event.clientY - box.top) * contentSize.height) / box.height,
            };
        }
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        return point.matrixTransform(svg.getScreenCTM().inverse());
    }

    function toSvgPoint(event) {
        return clientToSvg(event);
    }

    function toGraphPoint(event, rect = null) {
        const point = clientToSvg(event, rect);
        return {
            x: (point.x - transform.x) / transform.zoom,
            y: (point.y - transform.y) / transform.zoom,
        };
    }

    function stopAnimation() {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    function updatePositions() {
        if (!layout) return;
        const moved = new Set();
        for (const [id, group] of nodeElements) {
            const body = layout.get(id);
            if (!body) continue;
            const x = Math.round(body.x * 10) / 10;
            const y = Math.round(body.y * 10) / 10;
            if (body.renderX === x && body.renderY === y) continue;
            body.renderX = x;
            body.renderY = y;
            group.setAttribute('transform', `translate(${x} ${y})`);
            moved.add(id);
            labelGeometryVersion += 1;
        }
        for (const entry of edgePaths) {
            if (moved.has(entry.sourceId) || moved.has(entry.targetId)) updateEdgePath(entry);
        }
    }

    function updateEdgePath(entry) {
        const source = layout.get(entry.sourceId);
        const target = layout.get(entry.targetId);
        if (!source || !target) return;
        const path = edgePath(source, target, entry.curvature);
        entry.path.setAttribute('d', path);
        if (entry.hit) entry.hit.setAttribute('d', path);
    }

    function updateNodePosition(id) {
        const body = layout?.get(id);
        const group = nodeElements.get(id);
        if (!body || !group) return;
        const x = Math.round(body.x * 10) / 10;
        const y = Math.round(body.y * 10) / 10;
        if (body.renderX === x && body.renderY === y) return;
        body.renderX = x;
        body.renderY = y;
        group.setAttribute('transform', `translate(${x} ${y})`);
        labelGeometryVersion += 1;
        for (const entry of nodeEdges.get(id) || []) updateEdgePath(entry);
    }

    function startAnimation() {
        if (animationFrame !== null || !layout) return;
        // Every graph animates, including the curated one. Dense graphs run
        // physics every other frame with a bounded tick count so zoom, pan,
        // and dragging stay responsive while the layout is still alive.
        const largeGraph = (filtered?.nodes.length || 0) > LARGE_GRAPH_NODES;
        const tickLimit = largeGraph ? LARGE_GRAPH_TICK_LIMIT : 200;
        const stride = largeGraph ? 2 : 1;
        animationTicks = 0;
        let frameCount = 0;
        const step = () => {
            animationFrame = null;
            if (!layout) return;
            let active = true;
            if (frameCount % stride === 0) {
                active = layout.tick();
                updatePositions();
                animationTicks += 1;
            }
            frameCount += 1;
            // Recomputing labels while bodies move makes them pop in and out.
            // Refresh only once the simulation has settled or been capped.
            if (!active || animationTicks >= tickLimit) {
                refreshLabels(true);
                return;
            }
            animationFrame = requestAnimationFrame(step);
        };
        animationFrame = requestAnimationFrame(step);
    }

    function bindSvgEvents() {
        if (!canvas || canvas.dataset.bound === 'true') return;
        canvas.dataset.bound = 'true';

        canvas.addEventListener('click', (event) => {
            // Pointer interactions perform selection in pointerup so clicks and
            // drags can be told apart. Consume the synthetic click that follows.
            if (suppressClick) {
                suppressClick = false;
                return;
            }
            const edgeTarget = event.target.closest('[data-edge-id]');
            if (edgeTarget) {
                selectEdge(edgeTarget.dataset.edgeId);
                return;
            }
            const nodeTarget = event.target.closest('[data-node-id]');
            if (nodeTarget) {
                selectNode(nodeTarget.dataset.nodeId);
                return;
            }
            if (event.target === canvas || event.target.classList.contains('ia-network-background')) {
                clearSelection();
            }
        });

        canvas.addEventListener('keydown', (event) => {
            if (event.key === '+' || event.key === '=') {
                if (svg) {
                    event.preventDefault();
                    zoomBy(1.18);
                }
                return;
            }
            if (event.key === '-' || event.key === '_') {
                if (svg) {
                    event.preventDefault();
                    zoomBy(0.85);
                }
                return;
            }
            if (event.key === 'f' || event.key === 'F') {
                if (svg) {
                    event.preventDefault();
                    fitToScreen();
                }
                return;
            }
            if (event.key === '0') {
                if (svg) {
                    event.preventDefault();
                    resetNetworkView();
                }
                return;
            }
            const panSteps = {
                ArrowLeft: [1, 0],
                ArrowRight: [-1, 0],
                ArrowUp: [0, 1],
                ArrowDown: [0, -1],
            };
            if (panSteps[event.key]) {
                if (!svg) return;
                event.preventDefault();
                const step = event.shiftKey ? 120 : 40;
                transform.x += panSteps[event.key][0] * step;
                transform.y += panSteps[event.key][1] * step;
                clampTransform();
                applyTransform();
                return;
            }
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const nodeTarget = event.target.closest?.('[data-node-id]');
            if (nodeTarget) {
                event.preventDefault();
                selectNode(nodeTarget.dataset.nodeId);
                return;
            }
            const edgeTarget = event.target.closest?.('[data-edge-id]');
            if (edgeTarget) {
                event.preventDefault();
                selectEdge(edgeTarget.dataset.edgeId);
            }
        });

        // One gesture per pointer. The target captured at pointerdown decides
        // the interaction; movement past the threshold turns it into a drag
        // (node repositioning or network pan) instead of a click (selection).
        canvas.addEventListener('pointerdown', (event) => {
            if (!svg || gesture || (event.pointerType === 'mouse' && event.button !== 0)) return;
            clearPointerFocus();
            const nodeTarget = event.target.closest('[data-node-id]');
            const edgeTarget = event.target.closest('[data-edge-id]');
            const body = nodeTarget && layout ? layout.get(nodeTarget.dataset.nodeId) : null;
            if (nodeTarget && !body) return;
            // Lock the client-to-SVG mapping for the whole gesture so a scroll
            // or resize mid-drag cannot change the pointer's coordinate frame.
            const rect = typeof svg.getBoundingClientRect === 'function' ? svg.getBoundingClientRect() : null;
            const point = body ? toGraphPoint(event, rect) : null;

            gesture = {
                pointerId: event.pointerId,
                kind: nodeTarget ? 'node' : edgeTarget ? 'edge' : 'background',
                id: nodeTarget?.dataset.nodeId ?? edgeTarget?.dataset.edgeId ?? null,
                group: nodeTarget || null,
                focusTarget: nodeTarget || edgeTarget || null,
                rect,
                startPoint: body ? null : clientToSvg(event, rect),
                startX: event.clientX,
                startY: event.clientY,
                originX: transform.x,
                originY: transform.y,
                active: false,
                lastX: body?.x ?? 0,
                lastY: body?.y ?? 0,
                offsetX: body ? body.x - point.x : 0,
                offsetY: body ? body.y - point.y : 0,
                vx: 0,
                vy: 0,
            };
            if (body) {
                event.preventDefault();
                layout.setPinned(gesture.id, body.x, body.y);
            }
            canvas.setPointerCapture?.(event.pointerId);
        });

        canvas.addEventListener('pointermove', (event) => {
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            if (!gesture.active) {
                const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
                if (distance < PAN_THRESHOLD) return;
                gesture.active = true;
                if (gesture.kind === 'node') {
                    gesture.group.classList.add('is-dragging');
                    canvas.classList.add('is-dragging-node');
                    // The node is moved directly by pointermove. Running the
                    // full force simulation during a drag is what stalled the
                    // curated graph.
                } else {
                    // Edges and background both pan the whole network.
                    canvas.classList.add('is-panning');
                }
            }
            if (gesture.kind === 'node' && layout) {
                const point = toGraphPoint(event, gesture.rect);
                const nextX = point.x + gesture.offsetX;
                const nextY = point.y + gesture.offsetY;
                gesture.vx = (nextX - gesture.lastX) * 0.65;
                gesture.vy = (nextY - gesture.lastY) * 0.65;
                gesture.lastX = nextX;
                gesture.lastY = nextY;
                layout.setPinned(gesture.id, nextX, nextY);
                updateNodePosition(gesture.id);
                return;
            }
            const start = gesture.startPoint;
            const current = clientToSvg(event, gesture.rect);
            transform.x = gesture.originX + (current.x - start.x);
            transform.y = gesture.originY + (current.y - start.y);
            clampTransform();
            applyTransform();
        });

        const endPointer = (event) => {
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            const finished = gesture;
            gesture = null;
            suppressClick = true;
            // Mouse focus on nodes/edge hits is what produces the default
            // rectangle; blur it while leaving :focus-visible for keyboard use.
            blurIfFocused(finished.focusTarget);
            setTimeout(() => {
                suppressClick = false;
            }, 0);

            if (finished.active) {
                if (finished.kind === 'node') {
                    finished.group.classList.remove('is-dragging');
                    canvas.classList.remove('is-dragging-node');
                    if (layout) layout.release(finished.id, finished.vx, finished.vy);
                    startAnimation();
                } else {
                    canvas.classList.remove('is-panning');
                }
                scheduleLabels();
                return;
            }

            if (layout && finished.kind === 'node') layout.release(finished.id, 0, 0);
            if (finished.kind === 'node') selectNode(finished.id);
            else if (finished.kind === 'edge') selectEdge(finished.id);
            else clearSelection();
            startAnimation();
        };
        canvas.addEventListener('pointerup', endPointer);
        canvas.addEventListener('pointercancel', endPointer);
        canvas.addEventListener('lostpointercapture', endPointer);

        canvas.addEventListener('wheel', (event) => {
            if (!svg || gesture) return;
            event.preventDefault();
            zoomBy(event.deltaY < 0 ? 1.12 : 0.89, toSvgPoint(event));
        }, { passive: false });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && selected) clearSelection();
        });
    }

    if (details) {
        details.addEventListener('click', (event) => {
            const related = event.target.closest('[data-related-id]');
            if (related) selectNode(related.dataset.relatedId);
        });
    }

    if (controls && details) {
        detailsToggle = controls.querySelector('[data-network-action="toggle-details"]');
        if (!detailsToggle) {
            detailsToggle = document.createElement('button');
            detailsToggle.type = 'button';
            detailsToggle.className = 'tool-btn tool-btn-sm';
            controls.appendChild(detailsToggle);
        }
        detailsToggle.dataset.networkAction = 'toggle-details';
        if (details.id) detailsToggle.setAttribute('aria-controls', details.id);
        detailsToggle.setAttribute('aria-expanded', 'true');
        detailsToggle.setAttribute('aria-label', 'Hide details panel');
        detailsToggle.setAttribute('title', 'Hide details panel');
        detailsToggle.textContent = 'Hide details';
    }

    if (controls) {
        controls.addEventListener('click', (event) => {
            const action = event.target.closest('[data-network-action]')?.dataset.networkAction;
            if (action === 'zoom-in') zoomBy(1.18);
            if (action === 'zoom-out') zoomBy(0.85);
            if (action === 'fit') fitToScreen();
            if (action === 'reset') resetNetworkView();
            if (action === 'toggle-details') toggleDetails();
            if (action === 'settle') {
                layout?.reheat(0.6);
                if (!progressiveTasks.length && progressiveFrame === null) startAnimation();
            }
        });
    }

    const handleResize = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (!svg || !layout) return;
            const width = Math.max(320, Math.round(canvas.clientWidth || canvas.getBoundingClientRect?.().width || 800));
            const height = Math.max(300, Math.round(canvas.clientHeight || canvas.getBoundingClientRect?.().height || 590));
            if (width === contentSize.width && height === contentSize.height) return;
            contentSize = { width, height };
            svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
            const background = svg.querySelector('.ia-network-background');
            if (background) {
                background.setAttribute('width', String(width));
                background.setAttribute('height', String(height));
            }
            // Reuse the settled graph; rebuilding/reseeding on every panel
            // resize is expensive and makes collapse feel laggy.
            fitToScreen();
        }, 120);
    };
    if (canvas && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(canvas);
    } else {
        window.addEventListener('resize', handleResize);
    }

    bindSvgEvents();
    renderEmptyDetail();

    return {
        render(nextDataset, nextModel, nextFiltered) {
            dataset = nextDataset;
            model = nextModel;
            filtered = nextFiltered;
            renderGraph();
        },
        fitToScreen,
        toggleDetails,
        serializeSvg(metadata = {}) {
            if (!svg) return null;
            flushProgressive({ resume: false });
            const clone = svg.cloneNode(true);
            clone.setAttribute('xmlns', SVG_NS);
            clone.setAttribute('width', String(contentSize.width));
            clone.setAttribute('height', String(contentSize.height));
            clone.querySelectorAll('.ia-edge-hits').forEach((layer) => layer.remove());
            clone.querySelectorAll('.is-dimmed, .is-selected, .is-connected, .is-label-hidden').forEach((element) => {
                element.classList.remove('is-dimmed', 'is-selected', 'is-connected', 'is-label-hidden');
            });
            clone.querySelectorAll('[data-shared-pathogens]').forEach((element) => {
                element.removeAttribute('data-shared-pathogens');
            });
            clone.querySelectorAll('[tabindex], [aria-label]').forEach((element) => {
                element.removeAttribute('tabindex');
                element.removeAttribute('aria-label');
                if (element.getAttribute('role') === 'button') element.removeAttribute('role');
            });

            const background = getCssColor('--color-bg', '#ffffff');
            const text = getCssColor('--color-text', '#1e293b');
            const muted = getCssColor('--color-text-muted', '#64748b');
            const pathogen = getCssColor('--network-pathogen', '#7c3aed');
            const effector = getCssColor('--network-effector', '#2563eb');
            const host = getCssColor('--network-host', '#0f766e');
            const target = getCssColor('--network-target', '#b45309');
            const experimental = getCssColor('--evidence-experimental', '#16a34a');
            const predicted = getCssColor('--evidence-predicted', '#d97706');
            const annotation = getCssColor('--evidence-annotation-derived', '#2563eb');
            const hypothetical = getCssColor('--evidence-hypothetical', '#64748b');

            const style = document.createElementNS(SVG_NS, 'style');
            style.textContent = `
                .ia-network-background { fill: ${background}; }
                .ia-edge { fill: none; stroke-width: 2; stroke-linecap: round; opacity: .85; }
                .ia-edge--membership { stroke: ${muted}; stroke-width: 1.6; stroke-dasharray: 1 5; opacity: .7; }
                .ia-edge--interaction { stroke-width: 2; }
                .ia-edge--experimental { stroke: ${experimental}; }
                .ia-edge--predicted { stroke: ${predicted}; stroke-dasharray: 8 5; }
                .ia-edge--annotation-derived { stroke: ${annotation}; stroke-dasharray: 2 5; }
                .ia-edge--hypothetical { stroke: ${hypothetical}; stroke-dasharray: 10 4 2 4; }
                .ia-edge--none { stroke: ${muted}; stroke-dasharray: 2 5; opacity: .5; }
                .ia-edge-hit { fill: none; stroke: transparent; stroke-width: 12; }
                .ia-arrow-head { fill: ${muted}; }
                .ia-node-shape { stroke: ${background}; stroke-width: 1.5; }
                .ia-node--pathogen .ia-node-shape { fill: ${pathogen}; }
                .ia-node--effector .ia-node-shape { fill: ${effector}; }
                .ia-node--host_protein .ia-node-shape { fill: ${host}; }
                .ia-node--host_target .ia-node-shape { fill: ${target}; stroke-dasharray: 3 2; }
                .ia-shared-host-ring { fill: none; stroke: ${host}; stroke-width: 2; stroke-dasharray: 4 3; }
                .ia-node-label { fill: ${text}; stroke: ${background}; stroke-width: 3px; paint-order: stroke; font: 11px sans-serif; }
                .ia-node-label--pathogen { font-weight: 600; }
                .ia-node-label--host_protein { fill: ${host}; font-weight: 600; }
            `;

            const metadataNode = document.createElementNS(SVG_NS, 'metadata');
            metadataNode.textContent = JSON.stringify(metadata);
            clone.insertBefore(style, clone.firstChild);
            clone.insertBefore(metadataNode, style.nextSibling);

            return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
        },
    };
}

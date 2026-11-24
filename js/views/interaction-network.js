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
    MIN_ZOOM,
    seedOrganicPositions,
    sharedHostPathogens,
} from './network-layout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_RADIUS = 9;
const PAN_THRESHOLD = 4;
const PAN_LIMIT_X = 280;
const PAN_LIMIT_Y = 220;
const PAN_CAP_SCALE = 0.576;
const MAX_ZOOM = 4;

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

function labelRadiusFor(node) {
    return Math.min(46, Math.max(20, shortLabel(node).length * 3.1));
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
    onSelectionChange = () => {},
}) {
    let dataset = null;
    let model = null;
    let filtered = null;
    let selected = null;
    let svg = null;
    let viewport = null;
    let transform = { zoom: 1, x: 0, y: 0 };
    let panOrigin = { x: 0, y: 0 };
    let contentSize = { width: 1000, height: 700 };
    let gesture = null;
    let resizeTimer = null;
    let renderKey = null;
    let layout = null;
    let sharedHosts = new Map();
    let animationFrame = null;
    let nodeElements = new Map();
    let edgePaths = [];
    let suppressClick = false;

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

    function renderEmptyDetail() {
        const body = getDetailContainer();
        if (!body) return;
        body.replaceChildren();
        const container = createElement('div', 'ia-detail-empty');
        const title = createElement('p', 'ia-detail-empty-title');
        title.textContent = 'Select a node or interaction';
        const text = createElement('p', 'ia-muted');
        text.textContent =
            'Click a pathogen, effector, host protein, or interaction line to inspect its biology and evidence.';
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

    function applySelection() {
        if (!svg) return;
        const source = filtered || { interactionEdges: [], membershipEdges: [] };
        const connected = connectedSelection(source, selected);

        svg.querySelectorAll('[data-node-id]').forEach((node) => {
            const id = node.dataset.nodeId;
            const isRelevant = !selected || connected.nodes.has(id);
            node.classList.toggle('is-dimmed', !isRelevant);
            node.classList.toggle('is-connected', Boolean(selected) && connected.nodes.has(id));
            node.classList.toggle('is-selected', selected?.kind === 'node' && selected.id === id);
        });

        svg.querySelectorAll('[data-edge-id]').forEach((path) => {
            const id = path.dataset.edgeId;
            const relevant = !selected || connected.interactionEdges.has(id);
            path.classList.toggle('is-dimmed', !relevant);
            path.classList.toggle('is-connected', Boolean(selected) && relevant && selected?.kind !== 'edge');
            path.classList.toggle('is-selected', selected?.kind === 'edge' && selected.id === id);
        });

        svg.querySelectorAll('[data-membership-id]').forEach((path) => {
            const relevant = !selected || connected.membershipEdges.has(path.dataset.membershipId);
            path.classList.toggle('is-dimmed', !relevant);
            path.classList.toggle('is-connected', Boolean(selected) && relevant);
        });
    }

    function selectNode(nodeId, focusDetails = true) {
        if (!filtered?.nodes.some((node) => node.id === nodeId)) return;
        selected = { kind: 'node', id: nodeId };
        applySelection();
        renderDetail(buildNodeDetail(dataset, filtered, nodeId));
        onSelectionChange(selected);
        if (focusDetails && details) details.scrollTop = 0;
    }

    function selectEdge(edgeId) {
        if (!filtered?.interactionEdges.some((edge) => edge.id === edgeId)) return;
        selected = { kind: 'edge', id: edgeId };
        applySelection();
        renderDetail(buildEdgeDetail(dataset, filtered, edgeId));
        onSelectionChange(selected);
        if (details) details.scrollTop = 0;
    }

    function clearSelection() {
        selected = null;
        applySelection();
        renderEmptyDetail();
        onSelectionChange(null);
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
        viewport.setAttribute(
            'transform',
            `translate(${transform.x} ${transform.y}) scale(${transform.zoom})`
        );
    }

    function zoomBy(factor, anchor = null) {
        const nextZoom = clamp(transform.zoom * factor, MIN_ZOOM, MAX_ZOOM);
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
        transform = fitTransform(layout.bodies, contentSize.width, contentSize.height);
        panOrigin = { x: transform.x, y: transform.y };
        applyTransform();
    }

    function resetNetworkView() {
        layout?.reset();
        updatePositions();
        transform = { zoom: 1, x: 0, y: 0 };
        panOrigin = { x: 0, y: 0 };
        applyTransform();
        startAnimation();
    }

    function renderNetworkStatus() {
        const counts = filtered?.counts;
        if (!counts) return;
        const countText = [
            pluralize(counts.interactions, 'interaction'),
            pluralize(counts.effectors, 'effector'),
            pluralize(counts.hostProteins, 'host protein'),
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
        const nextKey = [
            Math.max(920, Math.round(canvas.clientWidth || 920)),
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
            onSelectionChange(null);
        }

        const hasInteractions = Boolean(filtered?.interactionEdges.length);
        if (canvas) canvas.hidden = !hasInteractions;
        if (empty) empty.hidden = hasInteractions;
        if (!hasInteractions) {
            stopAnimation();
            layout = null;
            sharedHosts = new Map();
            gesture = null;
            suppressClick = false;
            renderKey = null;
            svg = null;
            viewport = null;
            canvas.replaceChildren();
            if (selected) {
                selected = null;
                onSelectionChange(null);
            }
            renderEmptyDetail();
            setNetworkStatus('No interactions match the active filters.');
            return;
        }

        if (svg && nextKey === renderKey) {
            applyTransform();
            applySelection();
            renderNetworkStatus();
            renderCurrentDetail();
            return;
        }

        stopAnimation();
        layout = null;
        gesture = null;
        nodeElements = new Map();
        edgePaths = [];
        suppressClick = false;
        panOrigin = { x: transform.x, y: transform.y };
        renderKey = nextKey;
        canvas.replaceChildren();
        svg = null;
        viewport = null;

        const width = Math.max(920, Math.round(canvas.clientWidth || 920));
        const height = Math.max(
            620,
            Math.min(900, 420 + filtered.nodes.length * 4 + filtered.interactionEdges.length)
        );
        contentSize = { width, height };

        svg = createSvgElement('svg', {
            class: 'ia-network-svg',
            viewBox: `0 0 ${width} ${height}`,
            role: 'group',
            'aria-label': 'Force-directed interaction network of pathogens, effectors, and host proteins',
        });
        svg.appendChild(createSvgElement('title')).textContent =
            'Pathogen, effector, and host protein interaction network';

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
        const layoutNodes = filtered.nodes.map((node) => ({
            ...node,
            labelRadius: labelRadiusFor(node),
        }));
        seedOrganicPositions(layoutNodes, width, height, links);
        layout = createNetworkLayout({
            nodes: layoutNodes,
            links,
            width,
            height,
            radius: NODE_RADIUS + 4,
            top: 56,
            bottom: height - 56,
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
            edgeLayer.appendChild(path);
            edgePaths.push({ path, sourceId: edge.source, targetId: edge.target, curvature: 0 });
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
            edgeLayer.appendChild(path);

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
            hitLayer.appendChild(hit);
            edgePaths.push({
                path,
                hit,
                sourceId: edge.source,
                targetId: edge.target,
                curvature,
            });
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
                class: `ia-node-label ia-node-label--${node.type}`,
                x: 0,
                y: NODE_RADIUS + 16,
                'text-anchor': 'middle',
            });
            label.textContent = shortLabel(node);
            group.appendChild(label);

            nodeLayer.appendChild(group);
            nodeElements.set(node.id, group);
        });

        applyTransform();
        applySelection();
        renderNetworkStatus();
        canvas.appendChild(svg);
        layout.reheat(0.55);
        startAnimation();
        renderCurrentDetail();
    }

    function toSvgPoint(event, inverse = null) {
        if (!svg) return { x: 0, y: 0 };
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        return point.matrixTransform(inverse || svg.getScreenCTM().inverse());
    }

    function toGraphPoint(event, inverse = null) {
        const point = toSvgPoint(event, inverse);
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
        for (const [id, group] of nodeElements) {
            const body = layout.get(id);
            if (body) {
                group.setAttribute('transform', `translate(${body.x.toFixed(1)} ${body.y.toFixed(1)})`);
            }
        }
        for (const entry of edgePaths) {
            const source = layout.get(entry.sourceId);
            const target = layout.get(entry.targetId);
            if (!source || !target) continue;
            const path = edgePath(source, target, entry.curvature);
            entry.path.setAttribute('d', path);
            if (entry.hit) entry.hit.setAttribute('d', path);
        }
    }

    function startAnimation() {
        if (animationFrame !== null || !layout) return;
        const step = () => {
            animationFrame = null;
            if (!layout) return;
            const active = layout.tick();
            updatePositions();
            if (active) animationFrame = requestAnimationFrame(step);
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
            // Lock the screen-to-SVG matrix for the whole gesture so a scroll
            // or resize mid-drag cannot change the pointer's coordinate frame.
            const inverse = svg.getScreenCTM().inverse();
            const point = body ? toGraphPoint(event, inverse) : null;

            gesture = {
                pointerId: event.pointerId,
                kind: nodeTarget ? 'node' : edgeTarget ? 'edge' : 'background',
                id: nodeTarget?.dataset.nodeId ?? edgeTarget?.dataset.edgeId ?? null,
                group: nodeTarget || null,
                focusTarget: nodeTarget || edgeTarget || null,
                inverse,
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
                    startAnimation();
                } else {
                    // Edges and background both pan the whole network.
                    canvas.classList.add('is-panning');
                }
            }
            if (gesture.kind === 'node' && layout) {
                const point = toGraphPoint(event, gesture.inverse);
                const nextX = point.x + gesture.offsetX;
                const nextY = point.y + gesture.offsetY;
                gesture.vx = (nextX - gesture.lastX) * 0.65;
                gesture.vy = (nextY - gesture.lastY) * 0.65;
                gesture.lastX = nextX;
                gesture.lastY = nextY;
                layout.setPinned(gesture.id, nextX, nextY);
                updatePositions();
                return;
            }
            const start = toSvgPoint({ clientX: gesture.startX, clientY: gesture.startY }, gesture.inverse);
            const current = toSvgPoint(event, gesture.inverse);
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

    if (controls) {
        controls.addEventListener('click', (event) => {
            const action = event.target.closest('[data-network-action]')?.dataset.networkAction;
            if (action === 'zoom-in') zoomBy(1.18);
            if (action === 'zoom-out') zoomBy(0.85);
            if (action === 'fit') fitToScreen();
            if (action === 'reset') resetNetworkView();
            if (action === 'settle') {
                layout?.reheat(1);
                startAnimation();
            }
        });
    }

    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (filtered) renderGraph();
        }, 120);
    });

    bindSvgEvents();
    renderEmptyDetail();

    return {
        render(nextDataset, nextModel, nextFiltered) {
            dataset = nextDataset;
            model = nextModel;
            filtered = nextFiltered;
            renderGraph();
        },
        serializeSvg(metadata = {}) {
            if (!svg) return null;
            const clone = svg.cloneNode(true);
            clone.setAttribute('xmlns', SVG_NS);
            clone.setAttribute('width', String(contentSize.width));
            clone.setAttribute('height', String(contentSize.height));
            clone.querySelectorAll('.ia-edge-hits').forEach((layer) => layer.remove());
            clone.querySelectorAll('.is-dimmed, .is-selected, .is-connected').forEach((element) => {
                element.classList.remove('is-dimmed', 'is-selected', 'is-connected');
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

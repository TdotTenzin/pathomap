/*
  interaction-network.js - Layered SVG network view and details panel.

  The view renders a pathogen -> effector -> host-protein layout, handles
  selection/focus, zoom/pan, and builds the serialized SVG used by exports.
  Scientific joins and filtering live in js/analysis/network.js.
*/

import {
    EVIDENCE_CLASS_LABELS,
    NODE_TYPE_LABELS,
    buildEdgeDetail,
    buildNodeDetail,
    evidenceClassLabel,
} from '../analysis/network.js';
const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_RADIUS = 9;
const PATHOGEN_X = 190;

function svgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => {
        if (value !== null && value !== undefined) element.setAttribute(key, value);
    });
    return element;
}

function element(tag, className = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
}

function shortLabel(node) {
    const value = String(
        node.type === 'host_protein' ? node.gene_name || node.label : node.label || node.id
    );
    const limit = node.type === 'pathogen' ? 34 : node.type === 'host_protein' ? 24 : 26;
    return value.length > limit ? `${value.slice(0, limit - 1)}...` : value;
}

function lanePositions(nodes, top, bottom) {
    const step = nodes.length > 1 ? (bottom - top) / (nodes.length - 1) : 0;
    nodes.forEach((node, index) => {
        node.y = nodes.length > 1 ? top + step * index : (top + bottom) / 2;
    });
}

function orderedLanes(nodeList, interactionEdges) {
    const byType = {
        pathogen: nodeList.filter((node) => node.type === 'pathogen'),
        effector: nodeList.filter((node) => node.type === 'effector'),
        host_protein: nodeList.filter((node) => node.type === 'host_protein'),
    };

    byType.pathogen.sort((a, b) => a.label.localeCompare(b.label));

    const pathogenIndex = new Map(
        byType.pathogen.map((node, index) => [node.id, index])
    );
    const parentIndex = new Map(
        nodeList
            .filter((node) => node.type === 'effector')
            .map((node) => [node.id, pathogenIndex.get(node.pathogen_id) ?? 999])
    );

    byType.effector.sort((a, b) =>
        (parentIndex.get(a.id) - parentIndex.get(b.id)) || a.label.localeCompare(b.label)
    );

    const effectorY = new Map(
        byType.effector.map((node, index) => [
            node.id,
            byType.effector.length > 1 ? index : 0.5,
        ])
    );
    const hostScore = new Map();
    interactionEdges.forEach((edge) => {
        const score = effectorY.get(edge.source);
        if (score === undefined) return;
        const list = hostScore.get(edge.target) || [];
        list.push(score);
        hostScore.set(edge.target, list);
    });

    byType.host_protein.sort((a, b) => {
        const left = hostScore.get(a.id) || [];
        const right = hostScore.get(b.id) || [];
        const leftAverage = left.length ? left.reduce((sum, value) => sum + value, 0) / left.length : 999;
        const rightAverage = right.length ? right.reduce((sum, value) => sum + value, 0) / right.length : 999;
        return leftAverage - rightAverage || a.label.localeCompare(b.label);
    });

    return byType;
}

function edgePath(source, target) {
    const midpoint = (source.x + target.x) / 2;
    return `M ${source.x} ${source.y} C ${midpoint} ${source.y}, ${midpoint} ${target.y}, ${target.x} ${target.y}`;
}

function edgeClass(edge) {
    return edge.strongest_evidence_class || 'none';
}

function incidentNodeIds(model, selected) {
    const ids = new Set();
    if (!selected || selected.kind !== 'node') return ids;

    ids.add(selected.id);
    model.interactionEdges.forEach((edge) => {
        if ([edge.source, edge.target, edge.pathogen_id].includes(selected.id)) {
            ids.add(edge.source);
            ids.add(edge.target);
            if (edge.pathogen_id) ids.add(edge.pathogen_id);
        }
    });
    model.membershipEdges.forEach((edge) => {
        if (edge.source === selected.id) ids.add(edge.target);
        if (edge.target === selected.id) ids.add(edge.source);
    });
    return ids;
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
    let contentSize = { width: 1000, height: 700 };
    let pan = null;
    let resizeTimer = null;

    function setStatus(message) {
        if (!status) return;
        status.textContent = message || '';
    }

    function detailContainer() {
        if (!details) return null;
        let body = details.querySelector('.ia-detail-body');
        if (!body) {
            details.replaceChildren();
            body = element('div', 'ia-detail-body');
            details.appendChild(body);
        }
        return body;
    }

    function renderEmptyDetail() {
        const body = detailContainer();
        if (!body) return;
        body.replaceChildren();
        const container = element('div', 'ia-detail-empty');
        const title = element('p', 'ia-detail-empty-title');
        title.textContent = 'Select a node or interaction';
        const text = element('p', 'ia-muted');
        text.textContent =
            'Click a pathogen, effector, host protein, or relationship line to inspect its biology and evidence.';
        container.append(title, text);
        body.appendChild(container);
    }

    function addFieldList(parent, fields) {
        if (!fields.length) return;
        const dl = element('dl', 'ia-detail-fields');
        fields.forEach((item) => {
            const dt = element('dt');
            const dd = element('dd');
            dt.textContent = item.label;
            if (item.href) {
                const link = element('a');
                link.href = item.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = item.value;
                dd.appendChild(link);
            } else {
                dd.textContent = String(item.value);
            }
            dl.append(dt, dd);
        });
        parent.appendChild(dl);
    }

    function addParagraphs(parent, paragraphs) {
        paragraphs.forEach((item) => {
            const block = element('div', 'ia-detail-paragraph');
            const heading = element('p', 'ia-detail-section-label');
            const text = element('p');
            heading.textContent = item.label;
            text.textContent = item.text;
            block.append(heading, text);
            parent.appendChild(block);
        });
    }

    function addList(parent, label, items) {
        if (!items.length) return;
        const block = element('div', 'ia-detail-block');
        const heading = element('p', 'ia-detail-section-label');
        const list = element('ul', 'ia-detail-list');
        heading.textContent = label;
        items.forEach((item) => {
            const li = element('li');
            if (item.href) {
                const link = element('a');
                link.href = item.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = item.text;
                li.appendChild(link);
            } else {
                li.textContent = item.text;
            }
            list.appendChild(li);
        });
        block.append(heading, list);
        parent.appendChild(block);
    }

    function addRelated(parent, related) {
        if (!related.length) return;
        const block = element('div', 'ia-detail-block');
        const heading = element('p', 'ia-detail-section-label');
        const chips = element('div', 'ia-detail-chips');
        heading.textContent = 'Connected entities';
        related.forEach((item) => {
            const button = element('button', 'ia-detail-chip');
            button.type = 'button';
            button.dataset.relatedId = item.id;
            button.title = `${NODE_TYPE_LABELS[item.type] || item.type}: ${item.label}`;
            button.textContent = item.detail ? `${item.label} (${item.detail})` : item.label;
            chips.appendChild(button);
        });
        block.append(heading, chips);
        parent.appendChild(block);
    }

    function addEvidence(parent, evidence) {
        if (!evidence.length) return;
        const block = element('div', 'ia-detail-block');
        const heading = element('p', 'ia-detail-section-label');
        heading.textContent = 'Evidence records';
        const list = element('div', 'ia-evidence-list');

        evidence.forEach((record) => {
            const card = element('article', 'ia-evidence-card');
            const classRow = element('div', 'ia-evidence-card-head');
            const badge = element(
                'span',
                `ia-evidence-badge ia-evidence-badge--${record.evidence_class || 'hypothetical'}`
            );
            badge.textContent = evidenceClassLabel(record.evidence_class);
            classRow.appendChild(badge);
            if (record.evidence_id) {
                const id = element('span', 'ia-muted');
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
                const linkList = element('ul', 'ia-detail-list');
                links.forEach((item) => {
                    const li = element('li');
                    if (item.href) {
                        const link = element('a');
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
                const note = element('p', 'ia-evidence-note');
                note.textContent = record.note;
                card.appendChild(note);
            }
            if (record.provenance) {
                const provenance = element('p', 'ia-muted ia-evidence-provenance');
                provenance.textContent = record.provenance;
                card.appendChild(provenance);
            }
            list.appendChild(card);
        });

        block.append(heading, list);
        parent.appendChild(block);
    }

    function renderDetail(detail) {
        const body = detailContainer();
        if (!body) return;
        body.replaceChildren();

        if (!detail) {
            renderEmptyDetail();
            return;
        }

        const header = element('div', 'ia-detail-header');
        const badge = element(
            'span',
            detail.kind === 'edge' ? 'ia-detail-badge ia-detail-badge--edge' : `ia-detail-badge ia-detail-badge--${detail.type}`
        );
        badge.textContent = detail.kind === 'edge' ? 'Interaction' : detail.typeLabel;
        const title = element('h4', 'ia-detail-title');
        title.textContent = detail.title;
        header.append(badge, title);
        if (detail.subtitle) {
            const subtitle = element('p', 'ia-detail-subtitle');
            subtitle.textContent = detail.subtitle;
            header.appendChild(subtitle);
        }
        if (detail.id) {
            const id = element('code', 'ia-detail-id');
            id.textContent = detail.id;
            header.appendChild(id);
        }
        body.appendChild(header);

        addFieldList(body, detail.fields);
        addParagraphs(body, detail.paragraphs);
        detail.lists.forEach((item) => addList(body, item.label, item.items));
        addEvidence(body, detail.evidence);
        addRelated(body, detail.related);

        if (detail.externalLinks?.length) {
            const block = element('div', 'ia-detail-block');
            const heading = element('p', 'ia-detail-section-label');
            const list = element('ul', 'ia-detail-list');
            heading.textContent = 'External records';
            detail.externalLinks.forEach((item) => {
                const li = element('li');
                const link = element('a');
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

        const clear = element('button', 'tool-btn tool-btn-sm ia-detail-clear');
        clear.type = 'button';
        clear.textContent = 'Clear selection';
        clear.addEventListener('click', clearSelection);
        body.appendChild(clear);
    }

    function applySelection() {
        if (!svg) return;
        const connected = incidentNodeIds(model || { interactionEdges: [], membershipEdges: [] }, selected);

        svg.querySelectorAll('[data-node-id]').forEach((node) => {
            const id = node.dataset.nodeId;
            const isRelevant = !selected || connected.has(id);
            node.classList.toggle('is-dimmed', !isRelevant);
            node.classList.toggle('is-selected', selected?.kind === 'node' && selected.id === id);
        });

        svg.querySelectorAll('[data-edge-id]').forEach((path) => {
            const id = path.dataset.edgeId;
            const edge = model?.interactionEdges.find((item) => item.id === id);
            let relevant = !selected;

            if (selected?.kind === 'edge') {
                relevant = selected.id === id;
            } else if (selected?.kind === 'node' && edge) {
                relevant =
                    edge.source === selected.id ||
                    edge.target === selected.id ||
                    edge.pathogen_id === selected.id;
            }
            path.classList.toggle('is-dimmed', !relevant);
            path.classList.toggle('is-selected', selected?.kind === 'edge' && selected.id === id);
        });

        svg.querySelectorAll('[data-membership-id]').forEach((path) => {
            const edgeId = path.dataset.membershipId;
            const edge = model?.membershipEdges.find((item) => item.id === edgeId);
            const relevant =
                !selected ||
                (selected.kind === 'node' && edge && (edge.source === selected.id || edge.target === selected.id));
            path.classList.toggle('is-dimmed', !relevant);
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

    function applyTransform() {
        if (!viewport) return;
        viewport.setAttribute(
            'transform',
            `translate(${transform.x} ${transform.y}) scale(${transform.zoom})`
        );
    }

    function zoomBy(factor) {
        const centerX = contentSize.width / 2;
        const centerY = contentSize.height / 2;
        const nextZoom = Math.min(4, Math.max(0.45, transform.zoom * factor));
        const ratio = nextZoom / transform.zoom;
        transform.x = centerX - (centerX - transform.x) * ratio;
        transform.y = centerY - (centerY - transform.y) * ratio;
        transform.zoom = nextZoom;
        applyTransform();
    }

    function resetView() {
        transform = { zoom: 1, x: 0, y: 0 };
        applyTransform();
    }

    function drawLaneTitle(parent, label, x) {
        const title = svgElement('text', {
            x,
            y: 42,
            'text-anchor': 'middle',
            class: 'ia-lane-title',
        });
        title.textContent = label;
        parent.appendChild(title);
    }

    function drawGraph() {
        if (!canvas) return;
        canvas.replaceChildren();
        svg = null;
        viewport = null;

        const hasInteractions = Boolean(filtered?.interactionEdges.length);
        if (canvas) canvas.hidden = !hasInteractions;
        if (empty) empty.hidden = hasInteractions;
        if (!hasInteractions) {
            selected = null;
            renderEmptyDetail();
            setStatus('No interactions match the active filters.');
            onSelectionChange(null);
            return;
        }

        const width = Math.max(920, Math.round(canvas.clientWidth || 920));
        const maxLane = Math.max(
            1,
            ...['pathogen', 'effector', 'host_protein'].map(
                (type) => filtered.nodes.filter((node) => node.type === type).length
            )
        );
        const height = Math.max(640, maxLane * 25 + 140);
        contentSize = { width, height };

        svg = svgElement('svg', {
            class: 'ia-network-svg',
            viewBox: `0 0 ${width} ${height}`,
            role: 'img',
            'aria-label': 'Layered interaction network from pathogens through effectors to host proteins',
        });
        svg.appendChild(svgElement('title')).textContent = 'Pathogen, effector, and host protein interaction network';

        const background = svgElement('rect', {
            x: 0,
            y: 0,
            width,
            height,
            class: 'ia-network-background',
        });
        svg.appendChild(background);

        const defs = svgElement('defs');
        const marker = svgElement('marker', {
            id: 'ia-arrow',
            viewBox: '0 0 10 10',
            refX: '9',
            refY: '5',
            markerWidth: '6',
            markerHeight: '6',
            orient: 'auto-start-reverse',
        });
        marker.appendChild(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'ia-arrow-head' }));
        defs.appendChild(marker);
        svg.appendChild(defs);

        viewport = svgElement('g', { class: 'ia-viewport' });
        svg.appendChild(viewport);

        drawLaneTitle(viewport, `Pathogens (${filtered.nodes.filter((node) => node.type === 'pathogen').length})`, PATHOGEN_X);
        drawLaneTitle(viewport, `Effectors (${filtered.nodes.filter((node) => node.type === 'effector').length})`, width / 2);
        drawLaneTitle(viewport, `Host proteins (${filtered.nodes.filter((node) => node.type === 'host_protein').length})`, width - PATHOGEN_X);

        const lanes = orderedLanes(filtered.nodes, filtered.interactionEdges);
        const top = 92;
        const bottom = height - 48;
        lanePositions(lanes.pathogen, top, bottom);
        lanePositions(lanes.effector, top, bottom);
        lanePositions(lanes.host_protein, top, bottom);

        const positions = new Map();
        lanes.pathogen.forEach((node) => {
            node.x = PATHOGEN_X;
            positions.set(node.id, node);
        });
        lanes.effector.forEach((node) => {
            node.x = width / 2;
            positions.set(node.id, node);
        });
        lanes.host_protein.forEach((node) => {
            node.x = width - PATHOGEN_X;
            positions.set(node.id, node);
        });

        const edgeLayer = svgElement('g', { class: 'ia-edge-layer' });
        const hitLayer = svgElement('g', { class: 'ia-edge-hits' });
        viewport.append(edgeLayer, hitLayer);

        filtered.membershipEdges.forEach((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) return;
            const path = svgElement('path', {
                d: edgePath(source, target),
                class: 'ia-edge ia-edge--membership',
                'data-membership-id': edge.id,
            });
            edgeLayer.appendChild(path);
        });

        filtered.interactionEdges.forEach((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) return;
            const path = svgElement('path', {
                d: edgePath(source, target),
                class: `ia-edge ia-edge--interaction ia-edge--${edgeClass(edge)}`,
                'data-edge-id': edge.id,
            });
            edgeLayer.appendChild(path);

            const hit = svgElement('path', {
                d: edgePath(source, target),
                class: 'ia-edge-hit',
                'data-edge-id': edge.id,
                tabindex: '0',
                role: 'button',
                'aria-label': `Interaction ${edge.id}: ${source.label} targets ${target.label}`,
            });
            hitLayer.appendChild(hit);
        });

        const nodeLayer = svgElement('g', { class: 'ia-node-layer' });
        viewport.appendChild(nodeLayer);

        filtered.nodes.forEach((node) => {
            const position = positions.get(node.id);
            if (!position) return;

            const group = svgElement('g', {
                class: `ia-node ia-node--${node.type}`,
                transform: `translate(${position.x} ${position.y})`,
                'data-node-id': node.id,
                tabindex: '0',
                role: 'button',
                'aria-label': `${NODE_TYPE_LABELS[node.type]}: ${node.label}`,
            });

            let shape;
            if (node.type === 'pathogen') {
                const points = [];
                for (let index = 0; index < 6; index += 1) {
                    const angle = (Math.PI / 3) * index - Math.PI / 2;
                    points.push(
                        `${(NODE_RADIUS + 2) * Math.cos(angle)},${(NODE_RADIUS + 2) * Math.sin(angle)}`
                    );
                }
                shape = svgElement('polygon', { points: points.join(' '), class: 'ia-node-shape' });
            } else if (node.type === 'effector') {
                shape = svgElement('circle', { r: NODE_RADIUS, class: 'ia-node-shape' });
            } else {
                shape = svgElement('rect', {
                    x: -NODE_RADIUS,
                    y: -NODE_RADIUS + 2,
                    width: NODE_RADIUS * 2,
                    height: NODE_RADIUS * 2 - 4,
                    rx: 3,
                    class: 'ia-node-shape',
                });
            }
            group.appendChild(shape);

            const title = svgElement('title');
            title.textContent = `${NODE_TYPE_LABELS[node.type]}: ${node.label}`;
            group.appendChild(title);

            const label = svgElement('text', {
                class: `ia-node-label ia-node-label--${node.type}`,
                x: node.type === 'pathogen' ? -15 : node.type === 'host_protein' ? 15 : 0,
                y: node.type === 'pathogen' || node.type === 'host_protein' ? 4 : 22,
                'text-anchor':
                    node.type === 'pathogen' ? 'end' : node.type === 'host_protein' ? 'start' : 'middle',
            });
            label.textContent = shortLabel(node);
            group.appendChild(label);

            nodeLayer.appendChild(group);
        });

        applyTransform();
        applySelection();

        const countText = `${filtered.counts.interactions.toLocaleString()} interaction${filtered.counts.interactions === 1 ? '' : 's'} - ${filtered.counts.effectors.toLocaleString()} effectors - ${filtered.counts.hostProteins.toLocaleString()} host proteins - ${filtered.counts.pathogens.toLocaleString()} pathogens`;
        setStatus(countText);

        canvas.appendChild(svg);

        if (selected?.kind === 'node' && !filtered.nodes.some((node) => node.id === selected.id)) {
            selected = null;
            renderEmptyDetail();
        }
        if (selected?.kind === 'edge' && !filtered.interactionEdges.some((edge) => edge.id === selected.id)) {
            selected = null;
            renderEmptyDetail();
        }
        if (selected?.kind === 'node') {
            renderDetail(buildNodeDetail(dataset, filtered, selected.id));
        } else if (selected?.kind === 'edge') {
            renderDetail(buildEdgeDetail(dataset, filtered, selected.id));
        } else {
            renderEmptyDetail();
        }
    }

    function svgPoint(event) {
        if (!svg) return { x: 0, y: 0 };
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        return point.matrixTransform(svg.getScreenCTM().inverse());
    }

    function bindSvgEvents() {
        if (!canvas || canvas.dataset.bound === 'true') return;
        canvas.dataset.bound = 'true';

        canvas.addEventListener('click', (event) => {
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

        canvas.addEventListener('pointerdown', (event) => {
            if (event.target.closest('[data-node-id], [data-edge-id]')) return;
            if (!svg) return;
            pan = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                originX: transform.x,
                originY: transform.y,
            };
            canvas.setPointerCapture?.(event.pointerId);
            canvas.classList.add('is-panning');
        });

        canvas.addEventListener('pointermove', (event) => {
            if (!pan || pan.pointerId !== event.pointerId) return;
            const start = svgPoint({ clientX: pan.startX, clientY: pan.startY });
            const current = svgPoint(event);
            transform.x = pan.originX + (current.x - start.x);
            transform.y = pan.originY + (current.y - start.y);
            applyTransform();
        });

        const endPan = (event) => {
            if (!pan || pan.pointerId !== event.pointerId) return;
            pan = null;
            canvas.classList.remove('is-panning');
        };
        canvas.addEventListener('pointerup', endPan);
        canvas.addEventListener('pointercancel', endPan);
        canvas.addEventListener('pointerleave', endPan);

        canvas.addEventListener('wheel', (event) => {
            if (!svg) return;
            event.preventDefault();
            zoomBy(event.deltaY < 0 ? 1.12 : 0.89);
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
            if (action === 'fit') resetView();
        });
    }

    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (filtered) drawGraph();
        }, 120);
    });

    bindSvgEvents();
    renderEmptyDetail();

    return {
        render(nextDataset, nextModel, nextFiltered) {
            dataset = nextDataset;
            model = nextModel;
            filtered = nextFiltered;
            drawGraph();
        },
        clearSelection,
        getSelection() {
            return selected;
        },
        serializeSvg(metadata = {}) {
            if (!svg) return null;
            const clone = svg.cloneNode(true);
            clone.setAttribute('xmlns', SVG_NS);
            clone.setAttribute('width', String(contentSize.width));
            clone.setAttribute('height', String(contentSize.height));

            const background = getCssColor('--color-bg', '#ffffff');
            const text = getCssColor('--color-text', '#1e293b');
            const muted = getCssColor('--color-text-muted', '#64748b');
            const pathogen = getCssColor('--network-pathogen', '#7c3aed');
            const effector = getCssColor('--network-effector', '#2563eb');
            const host = getCssColor('--network-host', '#0f766e');
            const experimental = getCssColor('--evidence-experimental', '#16a34a');
            const predicted = getCssColor('--evidence-predicted', '#d97706');
            const annotation = getCssColor('--evidence-annotation', '#2563eb');
            const hypothetical = getCssColor('--evidence-hypothetical', '#64748b');

            const style = document.createElementNS(SVG_NS, 'style');
            style.textContent = `
                .ia-network-background { fill: ${background}; }
                .ia-lane-title { fill: ${muted}; font: 600 13px sans-serif; letter-spacing: .04em; text-transform: uppercase; }
                .ia-edge { fill: none; stroke-width: 1.8; opacity: .8; }
                .ia-edge--membership { stroke: ${muted}; stroke-width: 1.2; stroke-dasharray: 2 5; opacity: .55; }
                .ia-edge--experimental { stroke: ${experimental}; }
                .ia-edge--predicted { stroke: ${predicted}; stroke-dasharray: 8 5; }
                .ia-edge--annotation-derived { stroke: ${annotation}; stroke-dasharray: 2 5; }
                .ia-edge--hypothetical { stroke: ${hypothetical}; stroke-dasharray: 10 4 2 4; }
                .ia-edge--none { stroke: ${muted}; stroke-dasharray: 2 5; opacity: .5; }
                .ia-arrow-head { fill: ${muted}; }
                .ia-node-shape { stroke: ${background}; stroke-width: 1.5; }
                .ia-node--pathogen .ia-node-shape { fill: ${pathogen}; }
                .ia-node--effector .ia-node-shape { fill: ${effector}; }
                .ia-node--host_protein .ia-node-shape { fill: ${host}; }
                .ia-node-label { fill: ${text}; stroke: ${background}; stroke-width: 3px; paint-order: stroke; font: 11px sans-serif; }
                .ia-node-label--pathogen { font-weight: 600; }
                .ia-node-label--host_protein { fill: ${host}; font-weight: 600; }
                .ia-node.is-dimmed, .ia-edge.is-dimmed { opacity: .08; }
                .ia-node.is-selected .ia-node-shape { stroke: ${text}; stroke-width: 2.5; }
                .ia-edge.is-selected { stroke-width: 3; opacity: 1; }
            `;

            const metadataNode = document.createElementNS(SVG_NS, 'metadata');
            metadataNode.textContent = JSON.stringify(metadata);
            clone.insertBefore(style, clone.firstChild);
            clone.insertBefore(metadataNode, style.nextSibling);

            return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
        },
        getSvgText(metadata) {
            return this.serializeSvg(metadata);
        },
    };
}

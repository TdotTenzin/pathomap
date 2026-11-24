/*
  network-layout.js - Pure helpers for the organic interaction-network view.

  These helpers only arrange and describe nodes/edges that already exist in
  the network model. They never create biological relationships.
*/

const TYPE_ORDER = { pathogen: 0, effector: 1, host_protein: 2 };
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const MIN_ZOOM = 0.95;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function round(value) {
    return Math.round(value * 10) / 10;
}

function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function seedOrganicPositions(nodes, width, height, links = []) {
    const degree = new Map(nodes.map((node) => [node.id, 0]));
    links.forEach((link) => {
        const source = link.source?.id ?? link.source;
        const target = link.target?.id ?? link.target;
        if (degree.has(source)) degree.set(source, degree.get(source) + 1);
        if (degree.has(target)) degree.set(target, degree.get(target) + 1);
    });

    const ordered = [...nodes].sort((first, second) => {
        const degreeDifference = degree.get(second.id) - degree.get(first.id);
        if (degreeDifference) return degreeDifference;
        const typeDifference = (TYPE_ORDER[first.type] ?? 9) - (TYPE_ORDER[second.type] ?? 9);
        return typeDifference || String(first.id).localeCompare(String(second.id));
    });

    const centerX = width / 2;
    const centerY = height / 2;
    const radiusX = Math.max(120, width * 0.36);
    const radiusY = Math.max(110, height * 0.34);

    ordered.forEach((node, index) => {
        const angle = GOLDEN_ANGLE * index + (TYPE_ORDER[node.type] ?? 0) * 2.1;
        const spiral = Math.sqrt((index + 0.5) / Math.max(1, ordered.length));
        node.x = centerX + Math.cos(angle) * radiusX * spiral;
        node.y = centerY + Math.sin(angle) * radiusY * spiral;
    });

    return nodes;
}

export function sharedHostPathogens(interactionEdges = []) {
    const byHost = new Map();
    interactionEdges.forEach((edge) => {
        if (!edge.target || !edge.pathogen_id) return;
        if (!byHost.has(edge.target)) byHost.set(edge.target, new Set());
        byHost.get(edge.target).add(edge.pathogen_id);
    });
    return new Map([...byHost].filter(([, pathogens]) => pathogens.size > 1));
}

export function edgeCurvature(seed) {
    const hash = hashString(String(seed ?? ''));
    const sign = hash % 2 === 0 ? 1 : -1;
    const magnitude = 0.06 + ((hash >>> 1) % 9) * 0.012;
    return sign * magnitude;
}

export function edgePath(source, target, curvature = 0) {
    if (!source || !target) return '';
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.hypot(dx, dy);
    if (!curvature || length < 1) {
        return `M ${round(source.x)} ${round(source.y)} L ${round(target.x)} ${round(target.y)}`;
    }
    const offset = curvature * length;
    const controlX = (source.x + target.x) / 2 - (dy / length) * offset;
    const controlY = (source.y + target.y) / 2 + (dx / length) * offset;
    return `M ${round(source.x)} ${round(source.y)} Q ${round(controlX)} ${round(controlY)} ${round(target.x)} ${round(target.y)}`;
}

export function fitTransform(bodies = [], width, height, padding = 46) {
    if (!bodies.length) return { zoom: 1, x: 0, y: 0 };

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    bodies.forEach((body) => {
        const horizontal = body.labelRadius || body.radius || 12;
        const vertical = body.spacingY || body.radius || 12;
        minX = Math.min(minX, body.x - horizontal);
        maxX = Math.max(maxX, body.x + horizontal);
        minY = Math.min(minY, body.y - vertical);
        maxY = Math.max(maxY, body.y + vertical + 12);
    });

    const graphWidth = Math.max(1, maxX - minX);
    const graphHeight = Math.max(1, maxY - minY);
    const zoom = clamp(
        Math.min((width - padding * 2) / graphWidth, (height - padding * 2) / graphHeight),
        MIN_ZOOM,
        1.8
    );

    return {
        zoom,
        x: (width - graphWidth * zoom) / 2 - minX * zoom,
        y: (height - graphHeight * zoom) / 2 - minY * zoom,
    };
}

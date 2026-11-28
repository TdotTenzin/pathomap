/*
  network-layout.js - Pure helpers for the organic interaction-network view.

  These helpers only arrange and describe nodes/edges that already exist in
  the network model. They never create biological relationships.
*/

const TYPE_ORDER = { pathogen: 0, effector: 1, host_protein: 2 };
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// The overview of the curated graph is necessarily small; a restrictive
// minimum (0.95) made fit-to-screen impossible. Keep a floor only to avoid
// degenerate transforms, and let fitTransform choose the real scale.
export const MIN_ZOOM = 0.08;
const MAX_FIT_ZOOM = 1.8;
// A fit that shrinks typical neighbours below this screen distance makes dense
// graphs read as clumps, even when the full graph technically fits.
const MIN_SCREEN_SPACING = 18;

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

/**
 * Uniform grid used by both the force simulation and label placement.
 * Neighbour queries replace all-pairs scans; items with x/y coordinates can
 * be inserted and queried with independent horizontal/vertical radii.
 */
export function createSpatialIndex(cellSize = 96) {
    const size = Math.max(1, Number(cellSize) || 96);
    const cells = new Map();

    function key(cx, cy) {
        return `${cx},${cy}`;
    }

    function insert(item) {
        if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) return;
        const cellKey = key(Math.floor(item.x / size), Math.floor(item.y / size));
        let bucket = cells.get(cellKey);
        if (!bucket) {
            bucket = [];
            cells.set(cellKey, bucket);
        }
        bucket.push(item);
    }

    return {
        clear() {
            cells.clear();
        },
        insert,
        rebuild(items) {
            cells.clear();
            for (const item of items) insert(item);
        },
        forEachNear(x, y, radiusX, radiusY, visit) {
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            const horizontal = Math.max(0, radiusX || 0);
            const vertical = Math.max(0, radiusY || 0);
            const minX = Math.floor((x - horizontal) / size);
            const maxX = Math.floor((x + horizontal) / size);
            const minY = Math.floor((y - vertical) / size);
            const maxY = Math.floor((y + vertical) / size);
            for (let cx = minX; cx <= maxX; cx += 1) {
                for (let cy = minY; cy <= maxY; cy += 1) {
                    const bucket = cells.get(key(cx, cy));
                    if (!bucket) continue;
                    // Buckets are never mutated during a query; only body
                    // coordinates are, so iterating directly is safe.
                    for (const item of bucket) visit(item);
                }
            }
        },
    };
}

/** Virtual canvas size: large graphs get room to spread before fit-to-screen. */
export function graphWorldSize(nodeCount, width, height) {
    const side = Math.sqrt(Math.max(1, nodeCount));
    return {
        width: Math.max(Math.max(1, width), Math.ceil(side * 92)),
        height: Math.max(Math.max(1, height), Math.ceil(side * 80)),
    };
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

function graphBounds(bodies = []) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    bodies.forEach((body) => {
        if (!Number.isFinite(body.x) || !Number.isFinite(body.y)) return;
        const horizontal = Math.max(body.radius || 0, body.labelHalfWidth || body.labelRadius || 12);
        const vertical = Math.max(body.radius || 0, body.labelHalfHeight || body.spacingY || 12);
        minX = Math.min(minX, body.x - horizontal);
        maxX = Math.max(maxX, body.x + horizontal);
        minY = Math.min(minY, body.y - vertical);
        maxY = Math.max(maxY, body.y + vertical + 12);
    });
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY, graphWidth: Math.max(1, maxX - minX), graphHeight: Math.max(1, maxY - minY) };
}

function rawFitZoom(bounds, width, height, padding) {
    return Math.min(
        Math.max(1, width - padding * 2) / bounds.graphWidth,
        Math.max(1, height - padding * 2) / bounds.graphHeight
    );
}

/** Lower-quartile nearest-neighbour gap: robust to a few outlier bodies. */
function typicalNeighborSpacing(bodies = []) {
    const points = bodies.filter((body) => Number.isFinite(body.x) && Number.isFinite(body.y));
    if (points.length < 2) return Infinity;

    const gaps = points
        .map((point, index) => {
            let nearest = Infinity;
            for (let other = 0; other < points.length; other += 1) {
                if (other === index) continue;
                const gap = Math.hypot(points[other].x - point.x, points[other].y - point.y);
                if (gap > 0 && gap < nearest) nearest = gap;
            }
            return nearest;
        })
        .filter((gap) => Number.isFinite(gap))
        .sort((first, second) => first - second);

    return gaps.length ? gaps[Math.floor(gaps.length * 0.25)] : Infinity;
}

function spacingZoomFloor(bodies) {
    const spacing = typicalNeighborSpacing(bodies);
    if (!Number.isFinite(spacing) || spacing <= 0) return 0;
    return Math.min(MAX_FIT_ZOOM, MIN_SCREEN_SPACING / spacing);
}

/**
 * Zoom limits scale with the graph: small networks may zoom in far, dense
 * networks get a tighter ceiling and a looser floor around their fit scale.
 */
export function networkZoomRange(bodies = [], width, height, padding = 26) {
    const bounds = graphBounds(bodies);
    if (!bounds) return { minZoom: MIN_ZOOM, maxZoom: MAX_FIT_ZOOM, fit: 1 };
    const fit = rawFitZoom(bounds, width, height, padding);
    const spacingFloor = spacingZoomFloor(bodies);
    const largestRadius = bodies.reduce((radius, body) => Math.max(radius, body.radius || 12), 12);
    return {
        fit,
        minZoom: Math.max(MIN_ZOOM, fit / 2.5, spacingFloor),
        maxZoom: Math.min(8, Math.max(2, fit * 6, 26 / largestRadius, spacingFloor * 1.25)),
    };
}

export function fitTransform(bodies = [], width, height, padding = 46, options = {}) {
    const bounds = graphBounds(bodies);
    if (!bounds) return { zoom: 1, x: 0, y: 0 };

    const fit = rawFitZoom(bounds, width, height, padding);
    const minZoom = Math.max(options.minZoom ?? MIN_ZOOM, spacingZoomFloor(bodies));
    const zoom = clamp(fit, minZoom, options.maxZoom ?? MAX_FIT_ZOOM);

    return {
        zoom,
        x: (width - bounds.graphWidth * zoom) / 2 - bounds.minX * zoom,
        y: (height - bounds.graphHeight * zoom) / 2 - bounds.minY * zoom,
    };
}

/**
 * Prioritised non-overlapping label placement. Candidates carry measured
 * screen-space rectangles and a priority (selected > connected > type/degree).
 */
export function selectVisibleLabels(candidates = [], bounds = {}, options = {}) {
    const margin = options.margin ?? 2;
    const width = Number(bounds.width) || 0;
    const height = Number(bounds.height) || 0;
    const valid = candidates.filter(
        (item) =>
            item?.rect &&
            Number.isFinite(item.rect.x) &&
            Number.isFinite(item.rect.y) &&
            Number.isFinite(item.rect.width) &&
            Number.isFinite(item.rect.height)
    );
    if (!valid.length) return new Set();

    let maxHalfWidth = 0;
    let maxHalfHeight = 0;
    valid.forEach(({ rect }) => {
        maxHalfWidth = Math.max(maxHalfWidth, rect.width / 2);
        maxHalfHeight = Math.max(maxHalfHeight, rect.height / 2);
    });

    const index = createSpatialIndex(options.cellSize ?? Math.max(48, maxHalfWidth * 2));
    const chosen = new Set();
    const ordered = [...valid].sort(
        (first, second) =>
            (second.priority || 0) - (first.priority || 0) ||
            String(first.id).localeCompare(String(second.id))
    );

    for (const item of ordered) {
        const rect = item.rect;
        if (
            rect.x + rect.width < -margin ||
            rect.x > width + margin ||
            rect.y + rect.height < -margin ||
            rect.y > height + margin
        ) {
            continue;
        }
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        let collides = false;
        index.forEachNear(
            centerX,
            centerY,
            rect.width / 2 + maxHalfWidth + margin,
            rect.height / 2 + maxHalfHeight + margin,
            (other) => {
                if (collides) return;
                const occupied = other.rect;
                if (
                    rect.x < occupied.x + occupied.width + margin &&
                    rect.x + rect.width + margin > occupied.x &&
                    rect.y < occupied.y + occupied.height + margin &&
                    rect.y + rect.height + margin > occupied.y
                ) {
                    collides = true;
                }
            }
        );
        if (collides) continue;
        chosen.add(item.id);
        index.insert({ id: item.id, rect, x: centerX, y: centerY });
    }

    return chosen;
}

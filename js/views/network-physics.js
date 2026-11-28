/*
  network-physics.js - Lightweight force-directed layout for the interaction view.

  Nodes repel each other, links pull connected nodes together, and a weak
  centering force keeps the graph on screen. Collisions use a small node-sized
  envelope with soft velocity corrections; label readability is handled by the
  label-selection pass instead of pushing every node around to reserve text
  space. Repulsion and collision neighbours come from a uniform spatial grid
  rather than an all-pairs scan, which keeps large graphs usable.
*/

import { createSpatialIndex } from './network-layout.js';

const DAMPING = 0.85;
const REPULSION_STRENGTH = 1600;
const REPULSION_RANGE = 280;
const REPULSION_MAX = 3.5;
const LINK_STRENGTH = 0.022;
const LINK_MAX_FORCE = 2.4;
const LINK_DISTANCES = { membership: 96, interaction: 128 };
const CENTER_STRENGTH = 0.0011;
// Collisions reserve space for the node shape only. Labels are prioritised and
// hidden at dense zoom levels, so they must not drive the force simulation.
const COLLISION_PADDING = 7;
const COLLISION_RESPONSE = 0.14;
const MAX_COLLISION_CORRECTION = 1.4;
const MIN_COLLISION_CELL = 32;
const WALL_RESTITUTION = 0.5;
const MAX_SPEED = 14;
const MAX_DRAG_SPEED = 12;
const ALPHA_DECAY = 0.985;
const RELEASE_ALPHA = 0.18;
const STOP_ALPHA = 0.01;
const STOP_SPEED = 0.08;
// Keep large-graph settling bounded so the view stops churning promptly.
const MAX_TICKS = 200;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// The canvas grows with sqrt(nodeCount), so spring lengths and repulsion
// reach should grow with it too. Edge density weakens each spring so larger,
// better-connected graphs do not collapse into tight knots.
const REFERENCE_NODES = 64;
const REFERENCE_EDGES_PER_NODE = 1;
const MAX_SIZE_SCALE = 1.8;
const MIN_DENSITY_SCALE = 0.8;
const MAX_DENSITY_SCALE = 1.5;

export function networkForceProfile({ nodeCount = 0, linkCount = 0 } = {}) {
    const nodeScale = clamp(Math.sqrt(Math.max(1, nodeCount) / REFERENCE_NODES), 1, MAX_SIZE_SCALE);
    const density = linkCount / Math.max(1, nodeCount);
    const densityScale = clamp(density / REFERENCE_EDGES_PER_NODE, MIN_DENSITY_SCALE, MAX_DENSITY_SCALE);
    const spread = clamp(nodeScale * densityScale, 1, MAX_SIZE_SCALE * MAX_DENSITY_SCALE);
    return {
        nodeScale,
        densityScale,
        repulsionStrength: REPULSION_STRENGTH * (1 + (spread - 1) * 0.6),
        repulsionRange: REPULSION_RANGE * nodeScale,
        linkDistanceScale: nodeScale,
        linkStrengthScale: 1 / spread,
        centerStrength: CENTER_STRENGTH / nodeScale,
    };
}

function endpointId(value) {
    return typeof value === 'object' && value !== null ? value.id : value;
}

function direction(first, second) {
    let dx = second.x - first.x;
    let dy = second.y - first.y;
    let distance = Math.hypot(dx, dy);
    if (distance < 0.001) {
        dx = (first.index + second.index) % 2 === 0 ? 0.01 : -0.01;
        dy = (second.index % 2 === 0 ? 1 : -1) * 0.01;
        distance = Math.hypot(dx, dy);
    }
    return { dx, dy, distance, nx: dx / distance, ny: dy / distance };
}

function createBodies(nodes, radius) {
    return nodes.map((node, index) => {
        const labelRadius = Math.max(0, Number(node.labelRadius) || 0);
        const labelHalfHeight = Math.max(0, Number(node.labelHalfHeight) || 0);
        return {
            id: node.id,
            type: node.type,
            index,
            x: node.x,
            y: node.y,
            vx: 0,
            vy: 0,
            fx: null,
            fy: null,
            radius,
            // Kept for fit-to-screen bounds, never for collision resolution.
            labelRadius,
            labelHalfWidth: Math.max(0, Number(node.labelHalfWidth) || 0),
            labelHalfHeight,
            spacingX: radius + COLLISION_PADDING,
            spacingY: radius + COLLISION_PADDING,
        };
    });
}

function snapshotPositions(bodies) {
    return bodies.map(({ x, y }) => ({ x, y }));
}

function indexBodies(bodies) {
    return new Map(bodies.map((body) => [body.id, body]));
}

function createEdges(links, byId, distanceScale = 1) {
    return links
        .map((link) => ({
            source: byId.get(endpointId(link.source)),
            target: byId.get(endpointId(link.target)),
            distance: (LINK_DISTANCES[link.kind] || LINK_DISTANCES.interaction) * distanceScale,
            weight: link.kind === 'membership' ? 0.7 : 1,
        }))
        .filter((edge) => edge.source && edge.target && edge.source !== edge.target);
}

function createBounds({ width, radius, top, bottom }) {
    const minX = radius + 6;
    const maxX = width - radius - 6;
    const minY = top + radius;
    const maxY = bottom - radius;
    return {
        minX,
        maxX,
        minY,
        maxY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
    };
}

function addForce(body, x, y) {
    if (body.fx !== null) return;
    body.vx += x;
    body.vy += y;
}

function applyCenterForce(bodies, bounds, alpha, centerStrength) {
    for (const body of bodies) {
        const fx = (bounds.centerX - body.x) * centerStrength * alpha;
        const fy = (bounds.centerY - body.y) * centerStrength * alpha;
        addForce(body, fx, fy);
    }
}

function applyRepulsion(bodies, repulsion, alpha, range) {
    const rangeSquared = range * range;
    const index = createSpatialIndex(range / 2);
    index.rebuild(bodies);

    for (const first of bodies) {
        index.forEachNear(first.x, first.y, range, range, (second) => {
            if (second.index <= first.index) return;
            const vector = direction(first, second);
            const distanceSquared = vector.distance * vector.distance;
            if (distanceSquared > rangeSquared) return;

            const spring = clamp(repulsion / Math.max(distanceSquared, 400), 0, REPULSION_MAX);
            const force = spring * alpha;
            const fx = vector.nx * force;
            const fy = vector.ny * force;
            addForce(first, -fx, -fy);
            addForce(second, fx, fy);
        });
    }
}

function applyLinkForces(edges, alpha, linkStrengthScale) {
    const strength = LINK_STRENGTH * linkStrengthScale;
    for (const edge of edges) {
        const vector = direction(edge.source, edge.target);
        const stretch = vector.distance - edge.distance;
        const spring = clamp(stretch * strength, -LINK_MAX_FORCE, LINK_MAX_FORCE);
        const force = spring * alpha * edge.weight;
        addForce(edge.source, vector.nx * force, vector.ny * force);
        addForce(edge.target, -vector.nx * force, -vector.ny * force);
    }
}

function separate(first, second, axis, overlap, alpha) {
    const firstMovable = first.fx === null;
    const secondMovable = second.fx === null;
    const movableCount = Number(firstMovable) + Number(secondMovable);
    if (!movableCount) return;

    const sign = second[axis] >= first[axis] ? 1 : -1;
    const velocityKey = axis === 'x' ? 'vx' : 'vy';
    const correction = Math.min(overlap * COLLISION_RESPONSE * alpha, MAX_COLLISION_CORRECTION);
    const firstShare = firstMovable ? 1 / movableCount : 0;
    const secondShare = secondMovable ? 1 / movableCount : 0;

    // Nudge velocities instead of teleporting positions. Hard positional
    // corrections cascade through dense clusters and look like node bumping.
    if (firstMovable) first[velocityKey] -= sign * correction * firstShare;
    if (secondMovable) second[velocityKey] += sign * correction * secondShare;
}

function resolveCollisions(bodies, alpha) {
    let maxSpacingX = 0;
    let maxSpacingY = 0;
    for (const body of bodies) {
        maxSpacingX = Math.max(maxSpacingX, body.spacingX);
        maxSpacingY = Math.max(maxSpacingY, body.spacingY);
    }
    const index = createSpatialIndex(Math.max(MIN_COLLISION_CELL, maxSpacingX, maxSpacingY));
    index.rebuild(bodies);

    for (const first of bodies) {
        // A pair can only overlap when both axis gaps are below the sum of
        // their envelopes, bounded here by the largest envelopes in the graph.
        index.forEachNear(
            first.x,
            first.y,
            first.spacingX + maxSpacingX,
            first.spacingY + maxSpacingY,
            (second) => {
                if (second.index <= first.index) return;
                const dx = Math.abs(second.x - first.x);
                const dy = Math.abs(second.y - first.y);
                const requiredX = first.spacingX + second.spacingX;
                const requiredY = first.spacingY + second.spacingY;
                if (dx >= requiredX || dy >= requiredY) return;

                const overlapX = requiredX - dx;
                const overlapY = requiredY - dy;
                if (overlapX / requiredX <= overlapY / requiredY) {
                    separate(first, second, 'x', overlapX, alpha);
                } else {
                    separate(first, second, 'y', overlapY, alpha);
                }
            }
        );
    }
}

function integrate(body, bounds) {
    if (body.fx !== null) {
        body.x = body.fx;
        body.y = body.fy;
        body.vx = 0;
        body.vy = 0;
        return;
    }

    body.vx *= DAMPING;
    body.vy *= DAMPING;
    const speed = Math.hypot(body.vx, body.vy);
    if (speed > MAX_SPEED) {
        body.vx = (body.vx / speed) * MAX_SPEED;
        body.vy = (body.vy / speed) * MAX_SPEED;
    }

    body.x += body.vx;
    body.y += body.vy;

    if (body.x < bounds.minX) {
        body.x = bounds.minX;
        body.vx = Math.abs(body.vx) * WALL_RESTITUTION;
    } else if (body.x > bounds.maxX) {
        body.x = bounds.maxX;
        body.vx = -Math.abs(body.vx) * WALL_RESTITUTION;
    }

    if (body.y < bounds.minY) {
        body.y = bounds.minY;
        body.vy = Math.abs(body.vy) * WALL_RESTITUTION;
    } else if (body.y > bounds.maxY) {
        body.y = bounds.maxY;
        body.vy = -Math.abs(body.vy) * WALL_RESTITUTION;
    }
}

function peakSpeed(bodies) {
    return bodies.reduce((peak, body) => Math.max(peak, Math.abs(body.vx), Math.abs(body.vy)), 0);
}

function pinBody(body, bounds, x, y) {
    body.fx = clamp(x, bounds.minX, bounds.maxX);
    body.fy = clamp(y, bounds.minY, bounds.maxY);
    body.x = body.fx;
    body.y = body.fy;
    body.vx = 0;
    body.vy = 0;
    // Do not reheat here: dragging fires on every pointermove and would
    // otherwise keep the whole graph churning for the entire gesture.
}

function releaseBody(body, vx, vy) {
    body.fx = null;
    body.fy = null;
    body.vx = clamp(vx, -MAX_DRAG_SPEED, MAX_DRAG_SPEED);
    body.vy = clamp(vy, -MAX_DRAG_SPEED, MAX_DRAG_SPEED);
}

function resetBodies(bodies, initial) {
    bodies.forEach((body, index) => {
        body.x = initial[index].x;
        body.y = initial[index].y;
        body.vx = 0;
        body.vy = 0;
        body.fx = null;
        body.fy = null;
    });
}

export function createNetworkLayout({
    nodes,
    links = [],
    width,
    height,
    radius = 14,
    top = 70,
    bottom = height - 26,
    repulsion,
    forceProfile,
}) {
    const profile = forceProfile ?? networkForceProfile({ nodeCount: nodes.length, linkCount: links.length });
    const repulsionStrength = repulsion ?? profile.repulsionStrength;
    const bodies = createBodies(nodes, radius);
    const initial = snapshotPositions(bodies);
    const byId = indexBodies(bodies);
    const edges = createEdges(links, byId, profile.linkDistanceScale);
    const bounds = createBounds({ width, radius, top, bottom });
    let alpha = 0;
    let ticks = 0;

    function applyForces() {
        applyCenterForce(bodies, bounds, alpha, profile.centerStrength);
        applyRepulsion(bodies, repulsionStrength, alpha, profile.repulsionRange);
        applyLinkForces(edges, alpha, profile.linkStrengthScale);
    }

    function integrateAll() {
        for (const body of bodies) integrate(body, bounds);
    }

    return {
        bodies,
        profile,
        get(id) {
            return byId.get(id);
        },
        reheat(value = 0.7) {
            alpha = clamp(Math.max(alpha, value), 0, 1);
            ticks = 0;
        },
        setPinned(id, x, y) {
            const body = byId.get(id);
            if (body) pinBody(body, bounds, x, y);
        },
        release(id, vx = 0, vy = 0) {
            const body = byId.get(id);
            if (!body) return;
            releaseBody(body, vx, vy);
            alpha = Math.max(alpha, RELEASE_ALPHA);
            ticks = 0;
        },
        reset() {
            resetBodies(bodies, initial);
            alpha = 1;
            ticks = 0;
        },
        tick() {
            if (ticks >= MAX_TICKS) return false;
            if (alpha <= STOP_ALPHA && peakSpeed(bodies) < STOP_SPEED) return false;
            applyForces();
            resolveCollisions(bodies, alpha);
            integrateAll();
            alpha *= ALPHA_DECAY;
            ticks += 1;
            return true;
        },
    };
}

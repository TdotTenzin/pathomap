const DAMPING = 0.86;
const LANE_STRENGTH = 0.05;
const LINK_STRENGTH = 0.018;
const CENTER_STRENGTH = 0.0006;
const COLLISION_RESTITUTION = 0.55;
const WALL_RESTITUTION = 0.5;
const MAX_SPEED = 16;
const MAX_DRAG_SPEED = 12;
const ALPHA_DECAY = 0.985;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function endpointId(value) {
    return typeof value === 'object' && value !== null ? value.id : value;
}

export function createNetworkLayout({
    nodes,
    links = [],
    width,
    height,
    laneX,
    radius = 14,
    top = 70,
    bottom = height - 26,
}) {
    const bodies = nodes.map((node, index) => ({
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
        laneX: laneX[node.type] ?? width / 2,
    }));
    const byId = new Map(bodies.map((body) => [body.id, body]));
    const edges = links
        .map((link) => ({
            source: byId.get(endpointId(link.source)),
            target: byId.get(endpointId(link.target)),
            weight: link.kind === 'membership' ? 0.55 : 1,
        }))
        .filter((edge) => edge.source && edge.target && edge.source !== edge.target);

    const minX = radius + 6;
    const maxX = width - radius - 6;
    const minY = top + radius;
    const maxY = bottom - radius;
    const centerY = (minY + maxY) / 2;
    let alpha = 0;

    function applyForces() {
        for (const body of bodies) {
            body.vx += (body.laneX - body.x) * LANE_STRENGTH * alpha;
            body.vy += (centerY - body.y) * CENTER_STRENGTH * alpha;
        }

        for (const edge of edges) {
            const pull = clamp((edge.target.y - edge.source.y) * LINK_STRENGTH * alpha, -1.6, 1.6);
            edge.source.vy += pull * edge.weight;
            edge.target.vy -= pull * edge.weight;
        }
    }

    function resolveCollisions() {
        const cellSize = radius * 2;
        const buckets = new Map();
        for (const body of bodies) {
            const key = `${Math.floor(body.x / cellSize)},${Math.floor(body.y / cellSize)}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(body);
        }

        for (const body of bodies) {
            const cellX = Math.floor(body.x / cellSize);
            const cellY = Math.floor(body.y / cellSize);
            for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
                    const bucket = buckets.get(`${cellX + offsetX},${cellY + offsetY}`);
                    if (!bucket) continue;
                    for (const other of bucket) {
                        if (other.index <= body.index) continue;
                        collide(body, other);
                    }
                }
            }
        }
    }

    function collide(first, second) {
        let dx = second.x - first.x;
        let dy = second.y - first.y;
        let distance = Math.hypot(dx, dy);
        const minDistance = first.radius + second.radius;
        if (distance >= minDistance) return;

        if (distance === 0) {
            dx = first.index % 2 === 0 ? 0.01 : -0.01;
            dy = second.index % 2 === 0 ? 0.01 : -0.01;
            distance = Math.hypot(dx, dy);
        }

        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = minDistance - distance;
        const firstMovable = first.fx === null;
        const secondMovable = second.fx === null;
        const movableCount = Number(firstMovable) + Number(secondMovable);
        if (!movableCount) return;

        const firstShare = firstMovable ? 1 / movableCount : 0;
        const secondShare = secondMovable ? 1 / movableCount : 0;
        first.x -= nx * overlap * firstShare;
        first.y -= ny * overlap * firstShare;
        second.x += nx * overlap * secondShare;
        second.y += ny * overlap * secondShare;

        const relativeVelocity = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
        if (relativeVelocity >= 0) return;
        const impulse = (-(1 + COLLISION_RESTITUTION) * relativeVelocity) / movableCount;
        if (firstMovable) {
            first.vx -= impulse * nx;
            first.vy -= impulse * ny;
        }
        if (secondMovable) {
            second.vx += impulse * nx;
            second.vy += impulse * ny;
        }
    }

    function integrate(body) {
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

        if (body.x < minX) {
            body.x = minX;
            body.vx = Math.abs(body.vx) * WALL_RESTITUTION;
        } else if (body.x > maxX) {
            body.x = maxX;
            body.vx = -Math.abs(body.vx) * WALL_RESTITUTION;
        }

        if (body.y < minY) {
            body.y = minY;
            body.vy = Math.abs(body.vy) * WALL_RESTITUTION;
        } else if (body.y > maxY) {
            body.y = maxY;
            body.vy = -Math.abs(body.vy) * WALL_RESTITUTION;
        }
    }

    function peakSpeed() {
        return bodies.reduce((peak, body) => Math.max(peak, Math.abs(body.vx), Math.abs(body.vy)), 0);
    }

    return {
        bodies,
        get(id) {
            return byId.get(id);
        },
        reheat(value = 0.7) {
            alpha = clamp(Math.max(alpha, value), 0, 1);
        },
        setPinned(id, x, y) {
            const body = byId.get(id);
            if (!body) return;
            body.fx = clamp(x, minX, maxX);
            body.fy = clamp(y, minY, maxY);
            body.x = body.fx;
            body.y = body.fy;
            body.vx = 0;
            body.vy = 0;
            alpha = 1;
        },
        release(id, vx = 0, vy = 0) {
            const body = byId.get(id);
            if (!body) return;
            body.fx = null;
            body.fy = null;
            body.vx = clamp(vx, -MAX_DRAG_SPEED, MAX_DRAG_SPEED);
            body.vy = clamp(vy, -MAX_DRAG_SPEED, MAX_DRAG_SPEED);
            alpha = Math.max(alpha, 0.55);
        },
        tick() {
            if (alpha <= 0.01 && peakSpeed() < 0.08) return false;
            applyForces();
            resolveCollisions();
            for (const body of bodies) integrate(body);
            alpha *= ALPHA_DECAY;
            return true;
        },
    };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildNetworkModel, filterNetwork } from '../js/analysis/network.js';
import { createNetworkView } from '../js/views/interaction-network.js';

class FakeElement {
    constructor(tag = 'div') {
        this.tagName = tag;
        this.childNodes = [];
        this.parentNode = null;
        this.attributes = new Map();
        this._dataset = {};
        this.dataset = new Proxy(this._dataset, {
            set(target, key, value) {
                target[key] = String(value);
                self.attributes.set(`data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, String(value));
                return true;
            },
            deleteProperty(target, key) {
                delete target[key];
                self.attributes.delete(`data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
                return true;
            },
        });
        this._classNames = new Set();
        this.textContent = '';
        this.hidden = false;
        this.scrollTop = 0;
        this.listeners = new Map();
        const self = this;
        this.classList = {
            add(...names) {
                names.forEach((name) => self._classNames.add(name));
            },
            remove(...names) {
                names.forEach((name) => self._classNames.delete(name));
            },
            contains(name) {
                return self._classNames.has(name);
            },
            toggle(name, force) {
                const next = force === undefined ? !self._classNames.has(name) : Boolean(force);
                if (next) self._classNames.add(name);
                else self._classNames.delete(name);
                return next;
            },
        };
    }

    get children() {
        return this.childNodes;
    }

    get className() {
        return [...this._classNames].join(' ');
    }

    set className(value) {
        this._classNames = new Set(String(value || '').split(/\s+/).filter(Boolean));
    }

    setAttribute(name, value) {
        if (value === null || value === undefined) {
            this.removeAttribute(name);
            return;
        }
        this.attributes.set(name, String(value));
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            this._dataset[key] = String(value);
        }
        if (name === 'class') this.className = value;
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            delete this._dataset[key];
        }
    }

    appendChild(child) {
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }

    append(...children) {
        children.forEach((child) => this.appendChild(child));
    }

    replaceChildren(...children) {
        this.childNodes = [];
        this.append(...children);
    }

    insertBefore(child, reference) {
        child.parentNode = this;
        const index = reference ? this.childNodes.indexOf(reference) : -1;
        if (index < 0) this.childNodes.push(child);
        else this.childNodes.splice(index, 0, child);
        return child;
    }

    get firstChild() {
        return this.childNodes[0] || null;
    }

    remove() {
        if (!this.parentNode) return;
        const index = this.parentNode.childNodes.indexOf(this);
        if (index >= 0) this.parentNode.childNodes.splice(index, 1);
        this.parentNode = null;
    }

    cloneNode() {
        const copy = new FakeElement(this.tagName);
        copy.attributes = new Map(this.attributes);
        copy._dataset = { ...this._dataset };
        copy.className = this.className;
        copy.textContent = this.textContent;
        copy.hidden = this.hidden;
        copy.childNodes = this.childNodes.map((child) => {
            const cloned = child.cloneNode(true);
            cloned.parentNode = copy;
            return cloned;
        });
        return copy;
    }

    matches(selector) {
        return selector
            .split(',')
            .map((part) => part.trim())
            .some((part) => {
                if (part.startsWith('.')) return this.classList.contains(part.slice(1));
                const attribute = part.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
                if (attribute) {
                    const value = this.getAttribute(attribute[1]);
                    return value !== null && (!attribute[2] || value === attribute[2]);
                }
                return false;
            });
    }

    querySelectorAll(selector) {
        const found = [];
        const visit = (element) => {
            element.childNodes.forEach((child) => {
                if (child.matches(selector)) found.push(child);
                visit(child);
            });
        };
        visit(this);
        return found;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    closest(selector) {
        let current = this;
        while (current) {
            if (current.matches(selector)) return current;
            current = current.parentNode;
        }
        return null;
    }

    addEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(handler);
        this.listeners.set(type, handlers);
    }

    dispatch(type, event = {}) {
        const target = event.target || this;
        (this.listeners.get(type) || []).forEach((handler) => handler({ target, ...event }));
    }

    contains(node) {
        if (node === this) return true;
        return this.childNodes.some((child) => child.contains(node));
    }

    getBBox() {
        const width = this.textContent.length * 6;
        return { x: -width / 2, y: 12, width, height: 13 };
    }

    getComputedTextLength() {
        return this.textContent.length * 6;
    }

    createSVGPoint() {
        return {
            x: 0,
            y: 0,
            matrixTransform() {
                return { x: this.x, y: this.y };
            },
        };
    }

    getScreenCTM() {
        return { inverse: () => ({}) };
    }

    focus() {}
    blur() {}
    setPointerCapture() {}
}

const frames = new Map();
let frameId = 0;
globalThis.requestAnimationFrame = (callback) => {
    frameId += 1;
    frames.set(frameId, callback);
    return frameId;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
function flushFrames(limit = 500) {
    for (let index = 0; index < limit && frames.size; index += 1) {
        const [id, callback] = frames.entries().next().value;
        frames.delete(id);
        callback();
    }
}

globalThis.window = { addEventListener() {} };
globalThis.document = {
    documentElement: new FakeElement('html'),
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_, tag) => new FakeElement(tag),
    addEventListener() {},
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.XMLSerializer = class {
    serializeToString(element) {
        const attributeText = [...element.attributes]
            .map(([key, value]) => ` ${key}="${key === 'class' ? element.className : value}"`)
            .join('');
        const childText = element.childNodes.map((child) => this.serializeToString(child)).join('');
        const text = element.textContent ? `>${element.textContent}</${element.tagName}>` : `>${childText}</${element.tagName}>`;
        return `<${element.tagName}${attributeText}${text}`;
    }
};

function fixtureElements() {
    const canvas = new FakeElement('div');
    canvas.clientWidth = 900;
    canvas.clientHeight = 580;
    const controls = new FakeElement('div');
    const layout = new FakeElement('div');
    const details = new FakeElement('aside');
    details.id = 'ia-details';
    layout.appendChild(canvas);
    layout.appendChild(details);
    details.closest = (selector) => (selector === '.ia-network-layout' ? layout : null);
    return {
        canvas,
        details,
        controls,
        empty: new FakeElement('div'),
        status: new FakeElement('p'),
    };
}

const dataset = JSON.parse(fs.readFileSync(new URL('../data/pathomap-dataset.json', import.meta.url), 'utf8'));
const analysis = JSON.parse(
    fs.readFileSync(new URL('../data/derived/interaction_analysis.json', import.meta.url), 'utf8')
);
const model = buildNetworkModel(dataset, analysis);

function makeView() {
    const elements = fixtureElements();
    const view = createNetworkView(elements);
    return { ...elements, view };
}

test('full curated network renders, fits, labels, selects, filters and exports', async () => {
    const { canvas, controls, details, status, view } = makeView();
    const filtered = filterNetwork(model, {});
    view.render(dataset, model, filtered);
    view.fitToScreen();
    flushFrames();

    const svg = canvas.querySelector('.ia-network-svg');
    assert.ok(svg, 'SVG was created');
    assert.equal(svg.querySelectorAll('.ia-node').length, filtered.nodes.length);
    assert.equal(svg.querySelectorAll('.ia-edge--interaction').length, filtered.interactionEdges.length);
    assert.equal(svg.querySelectorAll('.ia-edge--membership').length, filtered.membershipEdges.length);
    assert.equal(filtered.counts.interactions, 246);
    assert.equal(filtered.counts.targetAssociations, 207);

    const viewport = svg.querySelector('.ia-viewport');
    const zoom = Number(viewport.getAttribute('transform').match(/scale\(([^)]+)\)/)[1]);
    assert.ok(zoom < 0.95 && zoom >= 0.08, `fit zoom ${zoom} uses the full graph bounds`);

    const labels = svg.querySelectorAll('.ia-node-label');
    assert.equal(labels.length, filtered.nodes.length);
    const visibleLabels = labels.filter((label) => !label.classList.contains('is-label-hidden'));
    assert.ok(visibleLabels.length > 0 && visibleLabels.length < labels.length);

    const readZoom = () =>
        Number(
            svg
                .querySelector('.ia-viewport')
                .getAttribute('transform')
                .match(/scale\(([^)]+)\)/)[1]
        );
    const zoomBeforeWheel = readZoom();
    canvas.dispatch('wheel', {
        deltaY: -120,
        clientX: 300,
        clientY: 200,
        preventDefault() {},
    });
    assert.ok(readZoom() > zoomBeforeWheel, 'wheel zooms in');
    flushFrames();

    const dragNode = svg.querySelectorAll('.ia-node')[1];
    const beforeDrag = dragNode.getAttribute('transform');
    canvas.dispatch('pointerdown', {
        target: dragNode,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 300,
        clientY: 300,
        preventDefault() {},
    });
    canvas.dispatch('pointermove', { pointerId: 1, clientX: 340, clientY: 320 });
    assert.equal(frames.size, 0, 'dragging a node does not schedule full-graph physics');
    canvas.dispatch('pointerup', { pointerId: 1, clientX: 340, clientY: 320 });
    flushFrames();
    assert.notEqual(dragNode.getAttribute('transform'), beforeDrag, 'dragging repositions a node');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const firstNode = svg.querySelector('.ia-node');
    canvas.dispatch('click', { target: firstNode });
    assert.ok(firstNode.classList.contains('is-selected'));
    assert.ok(details.querySelector('.ia-detail-title'));
    assert.ok(!firstNode.querySelector('.ia-node-label').classList.contains('is-label-hidden'));

    const toggle = controls.querySelector('[data-network-action="toggle-details"]');
    assert.ok(toggle, 'details toggle button is available in the toolbar');
    controls.dispatch('click', { target: toggle });
    assert.equal(details.hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    controls.dispatch('click', { target: toggle });
    assert.equal(details.hidden, false);

    const pathogenId = filtered.interactionEdges[0].pathogen_id;
    const narrowed = filterNetwork(model, { pathogenId });
    view.render(dataset, model, narrowed);
    flushFrames();
    const narrowedSvg = canvas.querySelector('.ia-network-svg');
    assert.equal(narrowedSvg.querySelectorAll('.ia-edge--interaction').length, narrowed.interactionEdges.length);
    assert.ok(narrowed.interactionEdges.length < filtered.interactionEdges.length);
    assert.match(status.textContent, /interaction/);

    view.render(dataset, model, filtered);
    flushFrames();
    const exported = view.serializeSvg({ counts: filtered.counts });
    assert.ok(exported.includes('xmlns'));
    assert.equal((exported.match(/data-node-id=/g) || []).length, filtered.nodes.length);
    assert.equal((exported.match(/data-edge-id=/g) || []).length, filtered.interactionEdges.length);
    assert.ok(!exported.includes('class="ia-edge-hit"'));
    assert.ok(!exported.includes('is-label-hidden'));
});

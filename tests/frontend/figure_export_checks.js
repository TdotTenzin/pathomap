/* Headless tests for js/figure-export.js.
 *
 * The export routines touch canvas/Image/XMLSerializer (browser-only), so this
 * harness exercises the pure helpers (filename normalisation, metadata footer)
 * and the offline guard paths (missing canvas/container return false) inside a
 * minimal VM sandbox.
 *
 * Run directly:  node tests/frontend/figure_export_checks.js
 * Or via pytest: pytest tests/test_frontend_js.py
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function makeEl() {
  return {
    style: {},
    setAttribute() {},
    getAttribute() { return null; },
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    click() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
}

const document = {
  getElementById: () => null,
  createElement: () => makeEl(),
  body: { appendChild() {}, removeChild() {} },
};

const ctx = {
  document,
  console,
  setTimeout,
  clearTimeout,
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  Blob: class FakeBlob { constructor(parts) { this.parts = parts; } },
  XMLSerializer: class { serializeToString() { return '<svg></svg>'; } },
  window: {},
  navigator: {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);

vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'js', 'figure-export.js'), 'utf8'),
  ctx,
  { filename: 'js/figure-export.js' }
);

let failures = 0;
function check(cond, msg) {
  if (cond) {
    console.log('ok - ' + msg);
  } else {
    failures += 1;
    console.error('FAIL - ' + msg);
  }
}

check(typeof ctx._safeName === 'function', '_safeName is defined');
check(ctx._safeName('Effector Types!') === 'effector_types', 'filename normalisation');
check(ctx._safeName('  a__B ') === 'a_b', 'filename trims and collapses separators');
check(ctx._safeName('') === '', 'empty name yields empty string');

check(typeof ctx.figureMetaText === 'function', 'figureMetaText is defined');
const meta = ctx.figureMetaText({ date: '2026-01-02' });
check(meta.indexOf('PathoMap v') === 0, 'metadata starts with the dataset version');
check(meta.indexOf('2026-01-02') !== -1, 'metadata includes the date');
const meta2 = ctx.figureMetaText({ date: '2026-01-02', params: 'strategy=escape' });
check(meta2.indexOf('strategy=escape') !== -1, 'metadata includes parameters when given');

check(typeof ctx.initFigureExport === 'function', 'initFigureExport is defined');
check(ctx.exportChartPNG('missing', 'x') === false, 'missing canvas returns false');
check(ctx.exportSVG('missing', 'x') === false, 'missing container returns false');
check(ctx.exportSVGPNG('missing', 'x') === false, 'missing container PNG returns false');

check(Array.isArray(ctx.FIGURE_TARGETS) && ctx.FIGURE_TARGETS.length >= 9, 'figure registry is populated');

if (failures > 0) {
  console.error(`\n${failures} figure-export check(s) failed`);
  process.exit(1);
}
console.log('\nall figure-export checks passed');

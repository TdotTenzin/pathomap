/* Headless test harness for the PathoMap frontend.
 *
 * Loads js/data.js, js/script.js and js/database.js into a sandbox with a
 * minimal DOM stub and exercises the pure logic behind the Database section:
 * schema normalisation, row counts, filtering, three-state sorting, CSV export
 * and cell rendering. No browser required.
 *
 * Run directly:  node tests/frontend/database_checks.js
 * Or via pytest: pytest tests/test_frontend_js.py
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

// --- minimal DOM stub -------------------------------------------------------
const nodes = {};
function makeNode(id) {
  // must cache: the real DOM returns the same element for repeat lookups, and
  // the code under test relies on that (it writes .value then re-reads by id)
  return nodes[id] || (nodes[id] = {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    style: {},
    attrs: {},
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    closest() { return null; },
    scrollIntoView() {},
    click() {},
  });
}
const document = {
  getElementById: (id) => makeNode(id),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => makeNode('__tmp'),
  body: { appendChild() {}, removeChild() {} },
};

// capture Blob contents so CSV output can be asserted on
let lastBlob = null;
class FakeBlob { constructor(parts) { lastBlob = parts.join(''); } }

const ctx = {
  document,
  window: { location: { protocol: 'http:' } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout,
  clearTimeout,
  console,
  Blob: FakeBlob,
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  navigator: { clipboard: {} },
};
ctx.globalThis = ctx;
vm.createContext(ctx);

for (const f of ['js/data.js', 'js/script.js', 'js/database.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}

// --- tiny assertion harness -------------------------------------------------
const failures = [];
let currentGroup = '';
function group(name) { currentGroup = name; console.log('\n' + name); }
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) {
    console.log(`         got  ${JSON.stringify(actual)}`);
    console.log(`         want ${JSON.stringify(expected)}`);
    failures.push(`${currentGroup} / ${label}`);
  }
}
function csvCellCountsOk(rows, columns) {
  const lines = lastBlob.trim().split('\n');
  if (lines.length - 1 !== rows.length) return false;
  // split on commas that are not inside quotes
  const cells = lines[1].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  return cells.length === columns.length;
}
const T = ctx.DB_TABLES;
const table = (id) => T.find((t) => t.id === id);
const searchBox = () => ctx.document.getElementById('db-search');

// --- 1. schema normalisation ------------------------------------------------
group('schema normalisation');
ctx._dbNormalise();
const D = ctx.TOOLKIT_DATA;
check('effectors keyed by effector_name', D.effectors.every((e) => e.effector_name !== undefined), true);
check('pathogens carry a numeric n_effectors', D.pathogens.every((p) => typeof p.n_effectors === 'number'), true);
check('no RangeIndex-style numeric keys leak in', D.effectors.every((e) => e.effector_name !== null), true);
check('interactions present offline', Array.isArray(D.interactions) && D.interactions.length === 150, true);

// --- 1b. literature layer ---------------------------------------------------
group('literature layer');
check('literature present offline', Array.isArray(D.literature) && D.literature.length > 0, true);
check('each reference has a PubMed URL',
  D.literature.every((r) => /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/.test(r.pubmed_url || '')), true);
check('_sourceLiterature returns the payload', ctx._sourceLiterature().length, D.literature.length);

// --- 2. table shape ---------------------------------------------------------
group('table row counts');
const EXPECTED = {
  pathogens: 54,
  effectors: 250,
  host_proteins: 72,
  interactions: 150,
  maturation_stages: 5,
};
check('exactly five tables', T.length, 5);
for (const [id, n] of Object.entries(EXPECTED)) {
  check(`${id} rows`, (table(id).rows(D) || []).length, n);
}

group('every declared column resolves to data');
for (const t of T) {
  const rows = t.rows(D) || [];
  // Stored columns (those without an `href`) must hold a value for some row.
  const stored = t.columns.filter((c) => typeof c.href !== 'function');
  const blank = stored.filter((c) => rows.every((r) => r[c.key] === undefined || r[c.key] === ''));
  check(`${t.id} has no unpopulated column`, blank.map((c) => c.key), []);
  // Derived link columns must produce a real URL for at least one row.
  for (const c of t.columns.filter((col) => typeof col.href === 'function')) {
    check(`${t.id} "${c.label}" link resolves`, rows.some((r) => !!c.href(r)), true);
  }
}

group('external database links');
const uniprotCol = table('host_proteins').columns.find((c) => c.key === 'uniprot_id');
const actin = table('host_proteins').rows(D).find((r) => r.name === 'Actin');
check('UniProt accession builds an entry URL',
  uniprotCol.href(actin), 'https://www.uniprot.org/uniprotkb/P68133/entry');
const noAcc = table('host_proteins').rows(D).find((r) => !r.uniprot_id);
check('a record without an accession renders a dash',
  /&mdash;/.test(ctx._dbLinkCell(noAcc, uniprotCol)), true);

const phiCol = table('effectors').columns.find((c) => c.label === 'PHI-base');
const sopE = table('effectors').rows(D).find((r) => r.effector_name === 'SopE');
check('PHI-base link is a name search',
  /^http:\/\/www\.phi-base\.org\/searchFacet\.htm\?queryTerm=SopE/.test(phiCol.href(sopE)), true);

const intactCol = table('interactions').columns.find((c) => c.label === 'IntAct');
check('IntAct link is a host-protein search',
  /^https:\/\/www\.ebi\.ac\.uk\/intact\/search\?query=/.test(intactCol.href({ host_protein: 'Rab1' })), true);
check('link cells open in a new tab and noopener',
  /target="_blank"/.test(ctx._dbLinkCell(sopE, phiCol)) &&
  /rel="noopener noreferrer"/.test(ctx._dbLinkCell(sopE, phiCol)), true);

// --- 3. search --------------------------------------------------------------
group('search filtering');
ctx._dbActive = 'pathogens';
function filterFor(q) { searchBox().value = q; return ctx._dbFiltered(table('pathogens')).length; }
check('empty query returns all rows', filterFor(''), 54);
const salmonella = filterFor('Salmonella');
check('"Salmonella" matches at least one', salmonella >= 1, true);
check('"Salmonella" is a strict subset', salmonella < 54, true);
check('nonsense query returns none', filterFor('zzzznotarealorganism'), 0);
check('search is case-insensitive', filterFor('salmonella'), filterFor('SALMONELLA'));

group('search is scoped to the visible table');
ctx._dbActive = 'interactions';
check('interactions match a pathogen name', ctx._dbFiltered(table('interactions')).length > 0, true);
ctx._dbActive = 'maturation_stages';
check('a pathogen search yields no stages', ctx._dbFiltered(table('maturation_stages')).length, 0);
searchBox().value = '';
check('clearing the search restores all stages', ctx._dbFiltered(table('maturation_stages')).length, 5);

// --- 4. sorting -------------------------------------------------------------
group('sorting is three-state and type-aware');
ctx._dbActive = 'pathogens';
searchBox().value = '';
ctx._dbSortBy('pathogens', 'n_effectors');
const asc = ctx._dbFiltered(table('pathogens')).map((r) => r.n_effectors);
check('numeric column sorts ascending', asc.every((v, i) => i === 0 || asc[i - 1] <= v), true);
check('largest value sorts last', asc[asc.length - 1], Math.max.apply(null, asc));
ctx._dbSortBy('pathogens', 'n_effectors');
const desc = ctx._dbFiltered(table('pathogens')).map((r) => r.n_effectors);
check('second click reverses direction', desc.every((v, i) => i === 0 || desc[i - 1] >= v), true);
ctx._dbSortBy('pathogens', 'n_effectors');
check('third click clears the sort', ctx._dbSort['pathogens'], undefined);

ctx._dbSortBy('pathogens', 'name');
const names = ctx._dbFiltered(table('pathogens')).map((r) => r.name);
check('text column sorts alphabetically', names.join('|'), names.slice().sort((a, b) => a.localeCompare(b)).join('|'));

ctx._dbActive = 'maturation_stages';
ctx._dbSortBy('maturation_stages', 'ph_min');
const ph = ctx._dbFiltered(table('maturation_stages')).map((r) => r.ph_min);
check('decimals sort numerically, not as text', ph.join('|'), ph.slice().sort((a, b) => a - b).join('|'));

// --- 5. CSV export ----------------------------------------------------------
group('CSV export handles mixed value types');
const mixed = [
  { name: 'Salmonella', n_effectors: 12 },
  { name: 'Listeria', n_effectors: 0 },
  { name: 'Yersinia', n_effectors: null },
  { name: 'Species "X"', n_effectors: 3 },
];
const mixedCols = [{ key: 'name', label: 'name' }, { key: 'n_effectors', label: 'n_effectors' }];
let threw = 'no';
try { ctx._downloadCSV(mixed, mixedCols, 'x.csv'); } catch (e) { threw = e.message; }
check('export does not throw on numbers/null', threw, 'no');
const lines = lastBlob.trim().split('\n');
check('header row', lines[0], '"name","n_effectors"');
check('number is written, not blanked', lines[1], '"Salmonella","12"');
check('zero survives', lines[2], '"Listeria","0"');
check('null becomes an empty field', lines[3], '"Yersinia",""');
check('embedded quotes are doubled', lines[4], '"Species ""X""","3"');

group('every real table exports cleanly');
for (const t of T) {
  const rows = t.rows(D) || [];
  const cols = t.columns.map((c) => ({ key: c.key, label: c.label }));
  let ok = false;
  try {
    ctx._downloadCSV(rows, cols, t.id + '.csv');
    ok = csvCellCountsOk(rows, cols);
  } catch (e) { ok = 'threw: ' + e.message; }
  check(`${t.id} exports ${rows.length} rows x ${cols.length} columns`, ok, true);
}

// --- 6. cell rendering ------------------------------------------------------
group('cell rendering escapes and truncates safely');
const evil = 'a<b>&c</b> ' + 'x'.repeat(200);
const evilCell = ctx._dbCell(evil, { key: 'd', long: true });
check('no raw tag is injected', /<b>/.test(evilCell), false);
check('angle brackets are entity-encoded', evilCell.indexOf('&lt;b&gt;') !== -1, true);
const displayed = evilCell.replace(/^<td[^>]*>/, '').replace(/<\/td>$/, '');
check('displayed text is truncated', displayed.length <= 95, true);
check('truncation is marked with an ellipsis', /\u2026$/.test(displayed), true);
check('full value is kept in the title attribute', /x{200}/.test(evilCell.slice(0, evilCell.lastIndexOf('">'))), true);
check('short text is escaped', /<i>/.test(ctx._dbCell('<i>x</i>', { key: 'd' })), false);
check('empty cell renders a dash', /&mdash;/.test(ctx._dbCell('', { key: 'd' })), true);
check('null cell renders a dash', /&mdash;/.test(ctx._dbCell(null, { key: 'd' })), true);
check('numeric cell renders with the alignment class', ctx._dbCell(42, { key: 'd', num: true }), '<td class="db-num">42</td>');

// --- 7. cross-section navigation -------------------------------------------
// An organism card or network click asks "show me this pathogen's effectors",
// so the effectors table is the intended landing spot, not pathogens.
group('focusDatabaseForPathogen shows that pathogen\'s effectors');
ctx.focusDatabaseForPathogen('Salmonella enterica');
check('activates the effectors table', ctx._dbActive, 'effectors');
check('prefills the search box', searchBox().value, 'Salmonella enterica');
const focused = ctx._dbFiltered(table('effectors'));
// resolve the column from the table definition so this survives a key rename
const pathogenCol = table('effectors').columns.find((c) => /pathogen/.test(c.key));
check('effectors table has a pathogen column', pathogenCol !== undefined, true);
check('every matching row belongs to that pathogen',
  focused.length > 0 && focused.every((r) => r[pathogenCol.key] === 'Salmonella enterica'), true);
check('narrower than the full table', focused.length < (table('effectors').rows(D) || []).length, true);
check('empty name is a no-op', (() => {
  const before = ctx._dbActive;
  ctx.focusDatabaseForPathogen('');
  return ctx._dbActive === before;
})(), true);

// --- summary ----------------------------------------------------------------
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`);
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nall frontend checks passed');
process.exit(0);

import { getDataset, getPathogens } from '../data/loader.js';
import {
  COLUMN_LABELS,
  COLUMN_META,
  PATHOGEN_COLUMNS,
  SCHEMA_VERSION,
  VISIBLE_COLUMNS,
} from '../data/schema.js';

const TABLES = [
  {
    id: 'pathogens',
    label: 'Pathogens',
    description:
      'Organisms with NCBI taxonomy, representative genome metadata, and intracellular survival strategy.',
    columns: VISIBLE_COLUMNS,
    exportColumns: PATHOGEN_COLUMNS,
  },
];

const STRATEGY_LABELS = {
  arrest: 'Arrest',
  escape: 'Escape',
  reroute: 'Reroute',
  modified_compartment: 'Modified compartment',
  extracellular: 'Extracellular',
  unknown: 'Unknown',
};

const state = {
  active: TABLES[0].id,
  search: '',
  sortKey: null,
  sortDir: 'asc',
};

function tableDef(id) {
  return TABLES.find((table) => table.id === id) || TABLES[0];
}

function rowsFor(def) {
  const rows = getPathogens();
  const query = state.search.trim().toLowerCase();
  let out = rows;

  if (query) {
    out = rows.filter((row) =>
      def.columns.some((column) =>
        String(row[column] ?? '').toLowerCase().includes(query)
      )
    );
  }

  if (state.sortKey) {
    const key = state.sortKey;
    const direction = state.sortDir === 'desc' ? -1 : 1;
    out = out.slice().sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * direction;
      }
      if (typeof av === 'boolean' && typeof bv === 'boolean') {
        return (Number(av) - Number(bv)) * direction;
      }
      const aText = av === null || av === undefined ? '' : String(av);
      const bText = bv === null || bv === undefined ? '' : String(bv);
      return aText.localeCompare(bText) * direction;
    });
  }

  return out;
}

function renderTabs() {
  const el = document.getElementById('db-tabs');
  if (!el) return;
  el.replaceChildren();
  TABLES.forEach((table) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'db-tab' + (table.id === state.active ? ' active' : '');
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', table.id === state.active ? 'true' : 'false');
    button.textContent = table.label;
    button.title = table.description;
    button.addEventListener('click', () => {
      state.active = table.id;
      state.search = '';
      state.sortKey = null;
      state.sortDir = 'asc';
      const search = document.getElementById('db-search');
      if (search) search.value = '';
      renderDatabase();
    });
    el.appendChild(button);
  });
}

function renderHead(def) {
  const el = document.getElementById('db-head');
  if (!el) return;
  el.replaceChildren();
  def.columns.forEach((column) => {
    const th = document.createElement('th');
    const label = COLUMN_LABELS[column] || column.replace(/_/g, ' ');
    th.textContent = label;
    if (column === state.sortKey) {
      th.textContent += state.sortDir === 'asc' ? ' ▲' : ' ▼';
    }
    th.style.cursor = 'pointer';
    th.title = 'Sort by ' + label;
    th.addEventListener('click', () => {
      if (state.sortKey === column) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = column;
        state.sortDir = 'asc';
      }
      renderDatabase();
    });
    el.appendChild(th);
  });
}

function displayValue(column, value) {
  if (value === null || value === undefined || value === '') return '';
  if (column === 'acid_fast') return value ? 'Yes' : 'No';
  if (column === 'strategy') return STRATEGY_LABELS[value] || value;
  if (column === 'genome_size_mb') return Number(value).toFixed(2);
  if (column === 'gc_content') return Number(value).toFixed(1);
  if (column === 'last_updated') return String(value).slice(0, 10);
  return String(value);
}

function renderBody(def, rows) {
  const el = document.getElementById('db-body');
  if (!el) return;
  el.replaceChildren();

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = def.columns.length;
    td.textContent = state.search ? 'No matching rows.' : 'No rows to display.';
    td.style.textAlign = 'center';
    td.style.color = 'var(--color-text-muted)';
    tr.appendChild(td);
    el.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    def.columns.forEach((column) => {
      const td = document.createElement('td');
      const value = row[column];
      if (column === 'reference_doi' && value) {
        const link = document.createElement('a');
        link.className = 'db-link';
        link.href = `https://doi.org/${value}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = value;
        td.appendChild(link);
      } else {
        td.textContent = displayValue(column, value);
      }
      tr.appendChild(td);
    });
    el.appendChild(tr);
  });
}

function renderStatus(def, rows) {
  const count = document.getElementById('db-count');
  const hint = document.getElementById('db-hint');
  if (count) {
    count.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;
  }
  if (hint) {
    hint.textContent = state.search ? `Filtered · ${def.description}` : def.description;
  }
}

function schemaLink(label, href) {
  const link = document.createElement('a');
  link.className = 'db-link';
  link.href = href;
  link.textContent = label;
  return link;
}

function renderSchema() {
  const body = document.getElementById('db-schema-body');
  if (!body) return;
  body.replaceChildren();

  const meta = getDataset().meta || {};
  const counts = meta.tables || {};
  const metaLine = document.createElement('p');
  metaLine.className = 'schema-meta';
  metaLine.textContent = [
    `Schema ${meta.schema_version || SCHEMA_VERSION}`,
    `${counts.pathogens ?? getPathogens().length} pathogens`,
    meta.built_at ? `Built ${String(meta.built_at).slice(0, 10)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  body.appendChild(metaLine);

  const links = document.createElement('p');
  links.className = 'schema-links';
  links.append(
    schemaLink('SQL schema', 'data/schema.sql'),
    document.createTextNode(' · '),
    schemaLink('SQLite database', 'data/pathomap.db'),
    document.createTextNode(' · '),
    schemaLink('JSON Schema', 'data/schema/pathogens.schema.json')
  );
  body.appendChild(links);

  const wrap = document.createElement('div');
  wrap.className = 'schema-table-wrap';
  const table = document.createElement('table');
  table.className = 'schema-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Field', 'Type', 'Description', 'Source'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  COLUMN_META.forEach((column) => {
    const tr = document.createElement('tr');
    const field = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = column.key;
    field.appendChild(code);
    tr.appendChild(field);

    const type = document.createElement('td');
    type.textContent = column.type;
    tr.appendChild(type);

    const description = document.createElement('td');
    description.textContent = column.description;
    tr.appendChild(description);

    const source = document.createElement('td');
    source.textContent = column.source;
    tr.appendChild(source);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  body.appendChild(wrap);
}

export function renderDatabase() {
  const def = tableDef(state.active);
  const rows = rowsFor(def);
  renderTabs();
  renderHead(def);
  renderBody(def, rows);
  renderStatus(def, rows);
  renderSchema();
  return rows;
}

export function getCurrentRows() {
  const def = tableDef(state.active);
  return { def, rows: rowsFor(def) };
}

function toCsv(def, rows) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const columns = def.exportColumns || def.columns;
  const header = columns.map((column) => escape(COLUMN_LABELS[column] || column)).join(',');
  const lines = rows.map((row) => columns.map((column) => escape(row[column])).join(','));
  return [header, ...lines].join('\n');
}

function downloadCsv() {
  const { def, rows } = getCurrentRows();
  const blob = new Blob([toCsv(def, rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `pathomap-${def.id}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function initDatabase() {
  renderDatabase();

  const search = document.getElementById('db-search');
  if (search) {
    search.addEventListener('input', (event) => {
      state.search = event.target.value;
      renderDatabase();
    });
  }

  const download = document.getElementById('db-download');
  if (download) {
    download.addEventListener('click', downloadCsv);
  }
}

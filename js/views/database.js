import { getDataset, getPathogens, getEffectors, getHostProteins } from '../data/loader.js';
import {
  COLUMN_LABELS,
  COLUMN_META,
  PATHOGEN_COLUMNS,
  SCHEMA_VERSION,
  VISIBLE_COLUMNS,
  EFFECTOR_COLUMNS_META,
  EFFECTOR_COLUMN_LABELS,
  EFFECTOR_VISIBLE_COLUMNS,
  EFFECTOR_COLUMNS,
  EFFECTOR_CLASSIFICATION_COLUMNS,
  CLASSIFICATION_LABELS,
  HOST_PROTEIN_COLUMNS_META,
  HOST_PROTEIN_COLUMN_LABELS,
  HOST_PROTEIN_VISIBLE_COLUMNS,
  HOST_PROTEIN_COLUMNS,
} from '../data/schema.js';

// Available tables to display in the database view
const TABLES = [
  {
    id: 'pathogens',
    label: 'Pathogens',
    description:
      'Organisms with NCBI taxonomy, representative genome metadata, and intracellular survival strategy.',
    columns: VISIBLE_COLUMNS,
    exportColumns: PATHOGEN_COLUMNS,
  },
  {
    id: 'effectors',
    label: 'Effectors',
    description:
      'Pathogen-derived effector proteins, their host targets, molecular functions, and mechanisms of host-cell manipulation.',
    columns: EFFECTOR_VISIBLE_COLUMNS,
    exportColumns: EFFECTOR_COLUMNS,
  },
  {
    id: 'host_proteins',
    label: 'Host Proteins',
    description:
      'Host proteins targeted by pathogen effectors, with UniProt identifiers, cellular localization, and functional annotations.',
    columns: HOST_PROTEIN_VISIBLE_COLUMNS,
    exportColumns: HOST_PROTEIN_COLUMNS,
  },
];

// Display labels for intracellular survival strategies
const STRATEGY_LABELS = {
  arrest: 'Arrest',
  escape: 'Escape',
  reroute: 'Reroute',
  modified_compartment: 'Modified compartment',
  extracellular: 'Extracellular',
  unknown: 'Unknown',
};

// Global state for database view (active table, search, sort, pagination)
const state = {
  active: TABLES[0].id,
  search: '',
  sortKey: null,
  sortDir: 'asc',
  page: 1,
  pageSize: 10,
};

// Get table definition by ID, fallback to first table if not found
function tableDef(id) {
  return TABLES.find((table) => table.id === id) || TABLES[0];
}

// Filter and sort rows based on current search and sort state
function rowsFor(def) {
  const rows = def.id === 'effectors' ? getEffectors() : def.id === 'host_proteins' ? getHostProteins() : getPathogens();
  const query = state.search.trim().toLowerCase();
  let out = rows;

  // Apply search filter
  if (query) {
    out = rows.filter((row) =>
      def.columns.some((column) =>
        String(row[column] ?? '').toLowerCase().includes(query)
      )
    );
  }

  // Apply sorting
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

// Paginate rows based on current page and page size
function paginateRows(rows) {
  const totalRows = rows.length;
  const totalPages = Math.ceil(totalRows / state.pageSize);

  // Ensure page is within valid bounds
  state.page = Math.max(1, Math.min(state.page, Math.max(1, totalPages)));

  const startIndex = (state.page - 1) * state.pageSize;
  const endIndex = startIndex + state.pageSize;

  return {
    rows: rows.slice(startIndex, endIndex),
    totalRows,
    totalPages,
    startIndex,
    endIndex: Math.min(endIndex, totalRows),
  };
}

// Render table tabs for switching between datasets
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
      state.page = 1;
      const search = document.getElementById('db-search');
      if (search) search.value = '';
      renderDatabase();
    });
    el.appendChild(button);
  });
}

// Render table header with sortable columns
function renderHead(def) {
  const el = document.getElementById('db-head');
  if (!el) return;
  el.replaceChildren();
  const labels = def.id === 'effectors' ? EFFECTOR_COLUMN_LABELS : def.id === 'host_proteins' ? HOST_PROTEIN_COLUMN_LABELS : COLUMN_LABELS;
  def.columns.forEach((column) => {
    const th = document.createElement('th');
    const label = labels[column] || column.replace(/_/g, ' ');
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
      state.page = 1;
      renderDatabase();
    });
    el.appendChild(th);
  });
}

// Format column values for display (handles special cases like booleans, enums, numbers)
function displayValue(column, value) {
  if (value === null || value === undefined || value === '') return '';
  if (column === 'acid_fast') return value ? 'Yes' : 'No';
  if (column === 'strategy') return STRATEGY_LABELS[value] || value;
  if (column === 'genome_size_mb') return Number(value).toFixed(2);
  if (column === 'gc_content') return Number(value).toFixed(1);
  if (column === 'last_updated') return String(value).slice(0, 10);
  return String(value);
}

// Create a classification badge element
function createClassificationBadge(classValue) {
  if (!classValue || classValue === 'unknown') return null;

  const badge = document.createElement('span');
  badge.className = 'classification-badge';
  badge.setAttribute('data-class', classValue);
  badge.textContent = CLASSIFICATION_LABELS[classValue] || classValue;
  return badge;
}

// Render table body with data rows
function renderBody(def, rows) {
  const el = document.getElementById('db-body');
  if (!el) return;
  el.replaceChildren();

  // Show empty state message if no rows
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

  // Render each row
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    def.columns.forEach((column) => {
      const td = document.createElement('td');
      const value = row[column];

      // Handle reference_doi links
      if (column === 'reference_doi' && value) {
        const link = document.createElement('a');
        link.className = 'db-link';
        link.href = `https://doi.org/${value}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = value;
        td.appendChild(link);
      }
      // Add classification badges for effector columns
      else if (def.id === 'effectors' && EFFECTOR_CLASSIFICATION_COLUMNS.includes(column)) {
        // Add the text value
        const textSpan = document.createElement('span');
        textSpan.textContent = displayValue(column, value);
        td.appendChild(textSpan);

        // Add classification badge if exists
        const classColumn = column + '_class';
        const classValue = row[classColumn];
        const badge = createClassificationBadge(classValue);
        if (badge) {
          td.appendChild(document.createTextNode(' '));
          td.appendChild(badge);
        }
      }
      // Default handling
      else {
        td.textContent = displayValue(column, value);
      }
      tr.appendChild(td);
    });
    el.appendChild(tr);
  });
}

// Render status information (row count and description)
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

function renderPagination(pagination) {
  const {
    totalRows,
    totalPages,
    startIndex,
    endIndex,
  } = pagination;

  const info = document.getElementById('db-pagination-info');
  const pageInfo = document.getElementById('db-page-info');
  const prevButton = document.getElementById('db-prev');
  const nextButton = document.getElementById('db-next');
  const pageSizeSelect = document.getElementById('db-page-size');

  info.textContent = totalRows === 0
    ? 'Showing 0 rows'
    : `Showing ${startIndex + 1}-${endIndex} of ${totalRows}`;

  pageInfo.textContent = `Page ${state.page} of ${Math.max(1, totalPages)}`;

  prevButton.disabled = state.page === 1;
  nextButton.disabled = state.page >= totalPages;

  pageSizeSelect.value = String(state.pageSize);
}

// Create a styled link for schema documentation
function schemaLink(label, href) {
  const link = document.createElement('a');
  link.className = 'db-link';
  link.href = href;
  link.textContent = label;
  return link;
}

// Render schema documentation table with column metadata
function renderSchema() {
  const body = document.getElementById('db-schema-body');
  if (!body) return;
  body.replaceChildren();

  const def = tableDef(state.active);
  const meta = getDataset().meta || {};
  const counts = meta.tables || {};
  const metaLine = document.createElement('p');
  metaLine.className = 'schema-meta';
  const columnMeta = def.id === 'effectors' ? EFFECTOR_COLUMNS_META : def.id === 'host_proteins' ? HOST_PROTEIN_COLUMNS_META : COLUMN_META;
  const tableLabel = def.id === 'effectors' ? 'effectors' : def.id === 'host_proteins' ? 'host proteins' : 'pathogens';
  const count = def.id === 'effectors' ? (counts.effectors ?? getEffectors().length) : def.id === 'host_proteins' ? (counts.host_proteins ?? getHostProteins().length) : (counts.pathogens ?? getPathogens().length);
  metaLine.textContent = [
    `Schema ${meta.schema_version || SCHEMA_VERSION}`,
    `${count} ${tableLabel}`,
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
  columnMeta.forEach((column) => {
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

// Main render function: updates all database view components
export function renderDatabase() {
  const def = tableDef(state.active);
  const rows = rowsFor(def);
  const pagination = paginateRows(rows);
  renderTabs();
  renderHead(def);
  renderBody(def, pagination.rows);
  renderStatus(def, rows);
  renderPagination(pagination);
  renderSchema();
  return rows;
}

// Get current table definition and filtered rows
export function getCurrentRows() {
  const def = tableDef(state.active);
  return { def, rows: rowsFor(def) };
}

// Convert rows to CSV format with proper escaping
function toCsv(def, rows) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const columns = def.exportColumns || def.columns;
  const labels = def.id === 'effectors' ? EFFECTOR_COLUMN_LABELS : def.id === 'host_proteins' ? HOST_PROTEIN_COLUMN_LABELS : COLUMN_LABELS;
  const header = columns.map((column) => escape(labels[column] || column)).join(',');
  const lines = rows.map((row) => columns.map((column) => escape(row[column])).join(','));
  return [header, ...lines].join('\n');
}

// Download current table as CSV file
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

// Initialize database view with event listeners
export function initDatabase() {
  renderDatabase();

  document.getElementById('db-search').addEventListener('input', (event) => {
    state.search = event.target.value;
    state.page = 1;
    renderDatabase();
  });

  document.getElementById('db-page-size').addEventListener('change', (event) => {
    state.pageSize = Number(event.target.value);
    state.page = 1;
    renderDatabase();
  });

  document.getElementById('db-prev').addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      renderDatabase();
    }
  });

  document.getElementById('db-next').addEventListener('click', () => {
    state.page++;
    renderDatabase();
  });

  document.getElementById('db-download').addEventListener('click', downloadCsv);
}

/*
  database.js - Main database-browser view (tabs, table, search, sort,
  pagination, CSV export, and the collapsible data dictionary).

  Purpose: Renders the three dataset tables (pathogens / effectors /
  host_proteins) into the #database section of index.html. All DOM updates go
  through renderDatabase(), which is re-invoked on every state change (tab
  switch, search keystroke, sort click, page nav).

  Exports:
    initDatabase()        Binds toolbar/search/pagination event listeners and
                          performs the first render. Called once from main.js.
    renderDatabase()      Recomputes filtered/sorted/paginated rows and redraws
                          every sub-component. Returns the full filtered row
                          array. Called by upload.js after data changes too.
    getCurrentRows()      Returns { def, rows } for the active table (used by
                          CSV export).

  Internal state (module-scoped `state` object):
    active   Current table id ('pathogens' | 'effectors' | 'host_proteins').
    search   Lowercase search string; filters across all visible columns.
    sortKey  Column key being sorted (null = no sort).
    sortDir  'asc' or 'desc'.
    page     1-based current page number.
    pageSize Rows per page (10 / 25 / 50, from the select control).

  Internal functions:
    tableDef(id)          Look up a TABLES entry by id (falls back to first).
    rowsFor(def)          Pull rows from the loader, apply search filter, then
                          apply sort (numeric-aware, boolean-aware, localeCompare
                          for strings).
    paginateRows(rows)    Clamp state.page into range, slice the page window,
                          and return { rows, totalRows, totalPages, start, end }.
    renderTabs()          Draw the tab buttons; clicking resets search/sort/page.
    renderHead(def)       Draw sortable <th> cells (▲/▼ indicator on active).
    displayValue(col, v)  Format a cell for display (Yes/No for acid_fast,
                          labels for strategy, fixed decimals for numbers).
    createClassificationBadge(classValue)  Build a colored <span> for an
                          effector/host-target classification, or null if
                          unknown/empty.
    renderBody(def, rows) Draw <tr> rows; special-cases reference_doi (link) and
                          effector classification columns (badge next to text).
    renderStatus(def, rows)  Update #db-count and #db-hint with row count/desc.
    renderPagination(pagination)  Update the "Showing X–Y of Z" text, page info,
                          and disable prev/next buttons at the ends.
    schemaLink(label, href)  Small helper for styled doc links.
    renderSchema()        Populate the <details> data dictionary from COLUMN_META
                          (or effector/host-protein equivalents), including
                          schema version, row count, and links to the SQL/JSON
                          schema files.
    toCsv(def, rows)      Serialize rows to CSV text, escaping quotes/commas/
                          newlines per RFC 4180.
    downloadCsv()         Trigger a browser download of the current table as
                          pathomap-<table>.csv.

  DOM elements it writes to (defined in index.html):
    #db-tabs, #db-search, #db-page-size, #db-prev, #db-next, #db-download,
    #db-count, #db-hint, #db-head, #db-body, #db-pagination-info,
    #db-page-info, #db-schema-body

  Note: All rendering is done via document.createElement (no innerHTML with
  data), which avoids XSS from user-uploaded datasets.
*/

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

// Available tables to display in the database view (id, label, description,
// visible columns for the UI, and full column list for CSV export)
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

// Filter and sort rows based on current search and sort state.
// Search matches any visible column (case-insensitive substring); sort is
// numeric-aware for numbers, boolean-aware for booleans, and localeCompare
// for strings/nulls.
function rowsFor(def) {
  const rows = def.id === 'effectors' ? getEffectors() : def.id === 'host_proteins' ? getHostProteins() : getPathogens();
  const query = state.search.trim().toLowerCase();
  let out = rows;

  // Apply search filter (matches if ANY visible column contains the query)
  if (query) {
    out = rows.filter((row) =>
      def.columns.some((column) =>
        searchText(row[column]).toLowerCase().includes(query)
      )
    );
  }

  // Apply sorting (numeric compare for numbers, locale-aware for text)
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
      const aText = searchText(av);
      const bText = searchText(bv);
      return aText.localeCompare(bText) * direction;
    });
  }

  return out;
}

// Paginate rows based on current page and page size.
// Clamps state.page into [1, totalPages] so it never goes out of range, then
// slices out just the rows for the current page window.
function paginateRows(rows) {
  const totalRows = rows.length;
  const totalPages = Math.ceil(totalRows / state.pageSize);

  // Ensure page is within valid bounds (handles shrink from deletes/filters)
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

// Render table tabs for switching between datasets (resets search/sort/page on switch)
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
      // Reset all view state when switching tables
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

// Render table header with sortable columns (click toggles asc/desc or sets a new sort)
function renderHead(def) {
  const el = document.getElementById('db-head');
  if (!el) return;
  el.replaceChildren();
  const labels = def.id === 'effectors' ? EFFECTOR_COLUMN_LABELS : def.id === 'host_proteins' ? HOST_PROTEIN_COLUMN_LABELS : COLUMN_LABELS;
  def.columns.forEach((column) => {
    const th = document.createElement('th');
    const label = labels[column] || column.replace(/_/g, ' ');
    th.textContent = label;
    // Show direction indicator on the active sort column
    if (column === state.sortKey) {
      th.textContent += state.sortDir === 'asc' ? ' ▲' : ' ▼';
    }
    th.style.cursor = 'pointer';
    th.title = 'Sort by ' + label;
    th.addEventListener('click', () => {
      if (state.sortKey === column) {
        // Same column: flip direction
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        // New column: start ascending
        state.sortKey = column;
        state.sortDir = 'asc';
      }
      state.page = 1;
      renderDatabase();
    });
    el.appendChild(th);
  });
}

// Collapse repeated labels into "name (×n)" so long redundant domain lists
// stay short; order of first appearance is preserved.
function dedupeWithCount(names) {
  const counts = new Map();
  const order = [];
  names.forEach((name) => {
    if (!counts.has(name)) {
      counts.set(name, 0);
      order.push(name);
    }
    counts.set(name, counts.get(name) + 1);
  });
  return order
    .map((name) => (counts.get(name) > 1 ? `${name} (×${counts.get(name)})` : name))
    .join(', ');
}

// Format column values for display (handles special cases like booleans, enums, numbers)
function displayValue(column, value) {
  if (value === null || value === undefined || value === '') return '';
  if (column === 'acid_fast') return value ? 'Yes' : 'No';
  if (column === 'strategy') return STRATEGY_LABELS[value] || value;
  if (column === 'genome_size_mb') return Number(value).toFixed(2);
  if (column === 'gc_content') return Number(value).toFixed(1);
  if (column === 'last_updated') return String(value).slice(0, 10);

  // Enrichment number formatting
  if (column === 'sequence_length') return String(value);
  if (column === 'molecular_weight_da') return Number(value).toFixed(1);
  if (column === 'isoelectric_point') return Number(value).toFixed(2);
  if (column === 'gravy_score') return Number(value).toFixed(3);

  // Array fields render as a comma-separated list of names/labels
  if (Array.isArray(value)) {
    if (column === 'domains') return dedupeWithCount(value.map((d) => d.name || d.accession || '').filter(Boolean));
    if (column === 'go_terms') return value.map((t) => t.term || t.id).filter(Boolean).join(', ');
    if (column === 'pathways_detailed') return value.map((p) => p.name || p.id).filter(Boolean).join(', ');
    if (column === 'interacting_partners') return value.map((p) => p.name || p.string_id).filter(Boolean).join(', ');
    if (column === 'transmembrane_regions') return `${value.length} region${value.length === 1 ? '' : 's'}`;
    return value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
  }

  // Signal peptide renders as its coordinate range
  if (column === 'signal_peptide' && typeof value === 'object') {
    return value.start != null && value.end != null ? `${value.start}-${value.end}` : 'yes';
  }

  return String(value);
}

// Text used for search matching: arrays/objects become JSON so nested values
// (domain names, GO terms, interaction partners) stay searchable.
function searchText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Create a classification badge element (returns null for empty/unknown values)
function createClassificationBadge(classValue) {
  if (!classValue || classValue === 'unknown') return null;

  const badge = document.createElement('span');
  badge.className = 'classification-badge';
  badge.setAttribute('data-class', classValue);
  badge.textContent = CLASSIFICATION_LABELS[classValue] || classValue;
  return badge;
}

// Render table body with data rows.
// Special handling: reference_doi renders as an external link; effector
// classification columns render the text value plus a colored badge for the
// matching *_class column.
function renderBody(def, rows) {
  const el = document.getElementById('db-body');
  if (!el) return;
  el.replaceChildren();

  // Show empty state message if no rows (different text when filtered vs empty)
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

  // Render each row, column by column, with per-column special cases
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
      // Sequences render as a truncated preview with a "Show full" toggle
      else if (column === 'sequence' && typeof value === 'string' && value) {
        const container = document.createElement('div');
        container.className = 'sequence-container';

        const preview = document.createElement('span');
        preview.className = 'sequence-preview';
        preview.textContent = value.length > 50 ? value.slice(0, 50) + '…' : value;
        container.appendChild(preview);

        if (value.length > 50) {
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'tool-btn sequence-toggle';
          toggle.textContent = 'Show full';
          toggle.addEventListener('click', () => {
            const expanded = toggle.dataset.expanded === 'true';
            preview.textContent = expanded ? value.slice(0, 50) + '…' : value;
            toggle.dataset.expanded = expanded ? 'false' : 'true';
            toggle.textContent = expanded ? 'Show full' : 'Show less';
          });
          container.appendChild(toggle);
        }

        td.appendChild(container);
      }
      // Domain lists render as a truncated preview with a "See more" toggle
      // so long repeated annotations don't stretch the table row
      else if (column === 'domains' && Array.isArray(value)) {
        const names = value.map((d) => d.name || d.accession || '').filter(Boolean);
        const fullText = dedupeWithCount(names);

        if (!fullText) {
          td.textContent = '';
        } else {
          const container = document.createElement('div');
          container.className = 'domain-container';

          const preview = document.createElement('span');
          preview.className = 'domain-preview';
          const previewText = fullText.length > 80 ? fullText.slice(0, 80) + '…' : fullText;
          preview.textContent = previewText;
          container.appendChild(preview);

          if (fullText.length > 80) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'tool-btn domain-toggle';
            toggle.textContent = 'See more';
            toggle.addEventListener('click', () => {
              const expanded = toggle.dataset.expanded === 'true';
              preview.textContent = expanded ? previewText : fullText;
              toggle.dataset.expanded = expanded ? 'false' : 'true';
              toggle.textContent = expanded ? 'See more' : 'Show less';
            });
            container.appendChild(toggle);
          }

          td.appendChild(container);
        }
      }
      // Add classification badges for effector columns
      else if (def.id === 'effectors' && EFFECTOR_CLASSIFICATION_COLUMNS.includes(column)) {
        // Add the text value
        const textSpan = document.createElement('span');
        textSpan.textContent = displayValue(column, value);
        td.appendChild(textSpan);

        // Add classification badge if exists (looks up column + '_class')
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

// Update pagination info text, page indicator, and prev/next button states
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

  // "Showing 1-10 of 53" style summary (handles the empty case)
  info.textContent = totalRows === 0
    ? 'Showing 0 rows'
    : `Showing ${startIndex + 1}-${endIndex} of ${totalRows}`;

  pageInfo.textContent = `Page ${state.page} of ${Math.max(1, totalPages)}`;

  // Disable prev on first page, next on last page
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

// Render schema documentation table with column metadata (the "Data dictionary"
// <details> panel). Pulls COLUMN_META (or effector/host-protein equivalent)
// for the active table and renders field/type/description/source rows plus
// links to the SQL schema, SQLite DB, and JSON Schema files.
function renderSchema() {
  const body = document.getElementById('db-schema-body');
  if (!body) return;
  body.replaceChildren();

  const def = tableDef(state.active);
  const meta = getDataset().meta || {};
  const counts = meta.tables || {};
  // Meta line: "Schema 2.0 · 53 pathogens · Built 2024-…"
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

  // Links to the SQL schema, SQLite DB, and JSON Schema files
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

  // Build the field/type/description/source table
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

// Main render function: updates all database view components in order
// (tabs -> head -> body -> status -> pagination -> schema dictionary)
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

// Get current table definition and filtered rows (used by CSV export)
export function getCurrentRows() {
  const def = tableDef(state.active);
  return { def, rows: rowsFor(def) };
}

// Convert rows to CSV format with RFC 4180 escaping (quotes, commas, newlines)
function toCsv(def, rows) {
  // Escape a single field: wrap in quotes and double any inner quotes when needed
  const escape = (value) => {
    const text =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const columns = def.exportColumns || def.columns;
  const labels = def.id === 'effectors' ? EFFECTOR_COLUMN_LABELS : def.id === 'host_proteins' ? HOST_PROTEIN_COLUMN_LABELS : COLUMN_LABELS;
  const header = columns.map((column) => escape(labels[column] || column)).join(',');
  const lines = rows.map((row) => columns.map((column) => escape(row[column])).join(','));
  return [header, ...lines].join('\n');
}

// Download current table as CSV file (creates a Blob and triggers browser download)
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

// Initialize database view with event listeners for search, page-size,
// prev/next, and CSV download. Performs the initial render.
export function initDatabase() {
  renderDatabase();

  // Search: filter on every keystroke, reset to page 1
  document.getElementById('db-search').addEventListener('input', (event) => {
    state.search = event.target.value;
    state.page = 1;
    renderDatabase();
  });

  // Page-size selector: change page size, reset to page 1
  document.getElementById('db-page-size').addEventListener('change', (event) => {
    state.pageSize = Number(event.target.value);
    state.page = 1;
    renderDatabase();
  });

  // Previous page button (clamped at page 1)
  document.getElementById('db-prev').addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      renderDatabase();
    }
  });

  // Next page button (paginateRows clamps at the last page)
  document.getElementById('db-next').addEventListener('click', () => {
    state.page++;
    renderDatabase();
  });

  // Download CSV for the current table + filter/sort state
  document.getElementById('db-download').addEventListener('click', downloadCsv);
}

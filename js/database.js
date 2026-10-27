/* ---------------------------------------------------------------------------
   Database browser

   Renders the five curated entities as sortable, filterable tables straight
   from TOOLKIT_DATA. This is the site's centrepiece: the charts elsewhere are
   derived from these same rows, and each table shows the SELECT that produces
   it.

   The data arrives on two paths — the embedded js/data.js payload (file://,
   or when the API is down) and /api/bootstrap — so every field is read
   defensively and the effectors are normalised to the *_name key convention
   used by the offline export.
   --------------------------------------------------------------------------- */

var _dbActive = null;   // id of the visible table
var _dbSort = {};       // id -> {key, dir}

/* External-database links. These are live queries built from a record's own
   name or accession at render time — never stored identifiers — so the site
   points at the databases without asserting that a specific curated record
   exists (which would be fabrication). */
var DB_EXTERNAL = {
  uniprot: function (acc) {
    return acc
      ? "https://www.uniprot.org/uniprotkb/" + encodeURIComponent(acc) + "/entry"
      : null;
  },
  phiBase: function (gene) {
    return gene
      ? "http://www.phi-base.org/searchFacet.htm?queryTerm=" + encodeURIComponent(gene)
      : null;
  },
  intact: function (term) {
    return term
      ? "https://www.ebi.ac.uk/intact/search?query=" + encodeURIComponent(term)
      : null;
  }
};

/* Table descriptors. `columns` names the row keys in TOOLKIT_DATA; `num`
   columns sort numerically rather than as text. A column with an `href`
   function renders as an external link instead of plain text: the value shown
   is `linkText(row)` when provided, otherwise `row[key]`. */
var DB_TABLES = [
  {
    id: "pathogens",
    label: "Pathogens",
    rows: function (d) { return d.pathogens || []; },
    columns: [
      { key: "name",         label: "Pathogen" },
      { key: "species",      label: "Species" },
      { key: "gram_stain",   label: "Gram" },
      { key: "strategy",     label: "Strategy" },
      { key: "n_effectors",  label: "Effectors", num: true },
      { key: "description",  label: "Description", long: true }
    ],
    sql: "SELECT p.name, p.species, p.gram_stain, p.strategy, p.description,\n" +
         "       COUNT(e.id) AS n_effectors\n" +
         "FROM pathogens p\n" +
         "LEFT JOIN effectors e ON e.pathogen_id = p.id\n" +
         "GROUP BY p.id\n" +
         "ORDER BY p.name;"
  },
  {
    id: "effectors",
    label: "Effectors",
    rows: function (d) { return d.effectors || []; },
    columns: [
      { key: "pathogen_name", label: "Pathogen" },
      { key: "effector_name", label: "Effector" },
      { key: "type",          label: "Type" },
      { key: "host_target",   label: "Host Target" },
      { key: "mechanism",     label: "Mechanism", long: true },
      { label: "PHI-base",    href: function (row) { return DB_EXTERNAL.phiBase(row.effector_name); } }
    ],
    sql: "SELECT p.name AS pathogen_name, e.name AS effector_name,\n" +
         "       e.type, e.host_target, e.mechanism\n" +
         "FROM effectors e\n" +
         "JOIN pathogens p ON e.pathogen_id = p.id\n" +
         "ORDER BY p.name, e.name;"
  },
  {
    id: "host_proteins",
    label: "Host Proteins",
    rows: function (d) { return d.host_proteins || []; },
    columns: [
      { key: "name",         label: "Protein" },
      { key: "full_name",    label: "Full Name", long: true },
      { key: "pathway",      label: "Pathway" },
      { key: "localization", label: "Localization" },
      { key: "function",     label: "Function", long: true },
      { key: "uniprot_id",   label: "UniProt", href: function (row) { return DB_EXTERNAL.uniprot(row.uniprot_id); } }
    ],
    sql: "SELECT name, full_name, function, localization, pathway, uniprot_id\n" +
         "FROM host_proteins\n" +
         "ORDER BY name;"
  },
  {
    id: "interactions",
    label: "Interactions",
    rows: function (d) { return d.interactions || []; },
    columns: [
      { key: "pathogen",         label: "Pathogen" },
      { key: "effector",         label: "Effector" },
      { key: "host_protein",     label: "Host Protein" },
      { key: "interaction_type", label: "Interaction" },
      { label: "IntAct",         href: function (row) { return DB_EXTERNAL.intact(row.host_protein); } }
    ],
    sql: "SELECT p.name AS pathogen, e.name AS effector,\n" +
         "       hp.name AS host_protein, et.interaction_type\n" +
         "FROM effector_targets et\n" +
         "JOIN effectors e      ON et.effector_id = e.id\n" +
         "JOIN pathogens p      ON e.pathogen_id = p.id\n" +
         "JOIN host_proteins hp ON et.host_protein_id = hp.id\n" +
         "ORDER BY p.name, e.name, hp.name;"
  },
  {
    id: "maturation_stages",
    label: "Maturation Stages",
    rows: function (d) { return d.maturation_stages || []; },
    columns: [
      { key: "stage_order", label: "#", num: true },
      { key: "name",        label: "Stage" },
      { key: "time_range",  label: "Time" },
      { key: "ph_min",      label: "pH min", num: true },
      { key: "ph_max",      label: "pH max", num: true },
      { key: "description", label: "What happens", long: true }
    ],
    sql: "SELECT stage_order, name, time_range, ph_min, ph_max, description\n" +
         "FROM maturation_stages\n" +
         "ORDER BY stage_order;"
  }
];

/* --------------------------------------------------------------------------
   Normalisation
   -------------------------------------------------------------------------- */

/* The live API and the offline export disagree on effector key names, and the
   live bootstrap omits n_effectors. Fill both gaps so a table never silently
   loses a column depending on which path served the data. */
function _dbNormalise() {
  var d = TOOLKIT_DATA;

  (d.effectors || []).forEach(function (e) {
    if (e.effector_name === undefined && e.effector !== undefined) e.effector_name = e.effector;
    if (e.pathogen_name === undefined && e.pathogen !== undefined) e.pathogen_name = e.pathogen;
  });

  // n_effectors: prefer the value already present, otherwise derive it.
  var byPathogen = {};
  (d.effectors || []).forEach(function (e) {
    var name = e.pathogen_name;
    if (!name) return;
    byPathogen[name] = (byPathogen[name] || 0) + 1;
  });
  (d.pathogens || []).forEach(function (p) {
    if (p.n_effectors === undefined || p.n_effectors === null) {
      p.n_effectors = byPathogen[p.name] || 0;
    }
  });
}

/* --------------------------------------------------------------------------
   Filtering + sorting
   -------------------------------------------------------------------------- */

function _dbFiltered(table) {
  var input = document.getElementById("db-search");
  var q = (input && input.value ? input.value : "").trim().toLowerCase();

  var rows = table.rows(TOOLKIT_DATA) || [];
  if (q) {
    rows = rows.filter(function (row) {
      return table.columns.some(function (col) {
        if (!col.key) return false;   // derived link columns are not searchable
        var v = row[col.key];
        return v !== undefined && v !== null &&
               String(v).toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  var sort = _dbSort[table.id];
  if (sort) {
    var col = null;
    table.columns.forEach(function (c) { if (c.key === sort.key) col = c; });
    if (col) {
      var dir = sort.dir === "desc" ? -1 : 1;
      rows = rows.slice().sort(function (a, b) {
        var av = a[col.key], bv = b[col.key];
        var an = (av === undefined || av === null || av === ""),
            bn = (bv === undefined || bv === null || bv === "");
        if (an && bn) return 0;
        if (an) return 1;   // blanks last regardless of direction
        if (bn) return -1;
        if (col.num) return (Number(av) - Number(bv)) * dir;
        return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
      });
    }
  }
  return rows;
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */

  function _dbTruncate(v, limit) {
    var s = String(v);
    if (s.length <= limit) return s;
    return s.slice(0, limit - 1).replace(/\s+\S*$/, "") + "…";
  }

function _dbCell(value, col) {
  if (value === undefined || value === null || value === "") {
    return '<td class="db-empty">&mdash;</td>';
  }
    if (col.num) return '<td class="db-num">' + _escapeHtml(String(value)) + "</td>";
   
    var s = String(value);
    var text = _escapeHtml(col.long ? _dbTruncate(s, 90) : s);
    var title = col.long && s.length > 90 ? ' title="' + _escapeHtml(s) + '"' : "";
    var cls = col.long ? ' class="db-long"' : "";
    return "<td" + cls + title + ">" + text + "</td>";
}

function _dbRenderTabs() {
  var host = document.getElementById("db-tabs");
  if (!host) return;
  host.innerHTML = DB_TABLES.map(function (t) {
    var n = (t.rows(TOOLKIT_DATA) || []).length;
    var active = t.id === _dbActive ? " active" : "";
    var dis = n === 0 ? " disabled" : "";
    return '<button type="button" role="tab" class="db-tab' + active + '"' +
           ' data-db-table="' + t.id + '"' + dis + ">" +
           _escapeHtml(t.label) + ' <span class="db-tab-count">' + n + "</span></button>";
  }).join("");
}

function _dbRenderHead(table) {
  var head = document.getElementById("db-head");
  if (!head) return;
  var sort = _dbSort[table.id];
  head.innerHTML = table.columns.map(function (col) {
    // Derived link columns hold no stored value, so they cannot be sorted.
    if (col.href && !col.key) {
      return '<th scope="col" class="db-linked">' + _escapeHtml(col.label) + "</th>";
    }
    var state = (sort && sort.key === col.key) ? sort.dir : "";
    var arrow = state === "asc" ? " ▲" : (state === "desc" ? " ▼" : "");
    return '<th scope="col"' +
           ' class="db-sortable' + (col.num ? " db-num" : "") + '"' +
           ' data-db-sort="' + col.key + '"' +
           ' aria-sort="' + (state === "asc" ? "ascending" : state === "desc" ? "descending" : "none") + '">' +
           _escapeHtml(col.label) + arrow + "</th>";
  }).join("");
}

/* A cell that links out to an external database (UniProt, PHI-base, IntAct).
   The href is computed per row; a null href renders the same em-dash as an
   empty value, so records without the relevant identifier degrade cleanly. */
function _dbLinkCell(row, col) {
  var url = col.href(row);
  if (!url) return '<td class="db-empty">&mdash;</td>';
  var text = col.linkText ? col.linkText(row) : (col.key ? row[col.key] : col.label);
  return '<td class="db-link"><a href="' + _escapeHtml(url) +
         '" target="_blank" rel="noopener noreferrer">' +
         _escapeHtml(text || col.label) + "</a></td>";
}

function _dbRenderBody(table, rows) {
  var body = document.getElementById("db-body");
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td class="db-none" colspan="' + table.columns.length + '">' +
                     "No rows match this filter.</td></tr>";
    return;
  }
  var html = "";
  for (var i = 0; i < rows.length; i++) {
    html += "<tr>";
    for (var c = 0; c < table.columns.length; c++) {
      var col = table.columns[c];
      html += col.href
        ? _dbLinkCell(rows[i], col)
        : _dbCell(rows[i][col.key], col);
    }
    html += "</tr>";
  }
  body.innerHTML = html;
}

function _dbRender() {
  var table = null;
  for (var i = 0; i < DB_TABLES.length; i++) {
    if (DB_TABLES[i].id === _dbActive) table = DB_TABLES[i];
  }
  if (!table) return;

  var rows = _dbFiltered(table);
  _dbRenderTabs();
  _dbRenderHead(table);
  _dbRenderBody(table, rows);

  var total = (table.rows(TOOLKIT_DATA) || []).length;
  var countEl = document.getElementById("db-count");
  if (countEl) {
    countEl.textContent = rows.length === total
      ? rows.length + " rows"
      : rows.length + " of " + total + " rows";
  }
  var hintEl = document.getElementById("db-hint");
  if (hintEl) {
    hintEl.textContent = rows.length === total
      ? ""
      : "filtered";
  }

  var sqlEl = document.getElementById("db-sql");
  if (sqlEl) sqlEl.textContent = table.sql;

  var dl = document.getElementById("db-download");
  if (dl) {
    dl.disabled = rows.length === 0;
    dl.setAttribute("data-db-file", table.id + ".csv");
  }
}

function _dbSelectTable(id) {
  if (_dbActive === id) return;
  _dbActive = id;
  _dbRender();
}

function _dbSortBy(tableId, key) {
  var cur = _dbSort[tableId];
  if (!cur || cur.key !== key) _dbSort[tableId] = { key: key, dir: "asc" };
  else if (cur.dir === "asc") _dbSort[tableId] = { key: key, dir: "desc" };
  else delete _dbSort[tableId];      // third click clears the sort
  _dbRender();
}

function _dbDownload() {
  var btn = document.getElementById("db-download");
  if (!btn || typeof _downloadCSV !== "function") return;
  var table = null;
  DB_TABLES.forEach(function (t) { if (t.id === _dbActive) table = t; });
  if (!table) return;
  // Derived link columns carry no stored value, so they are omitted from CSV —
  // the accession/id columns they wrap are exported instead.
  var cols = table.columns
    .filter(function (c) { return c.key; })
    .map(function (c) { return { key: c.key, label: c.label }; });
  _downloadCSV(
    _dbFiltered(table),
    cols,
    btn.getAttribute("data-db-file") || (table.id + ".csv")
  );
}

/* Used by the effector chart's click handler: jump to the Effectors table
   pre-filtered to one pathogen. */
function focusDatabaseForPathogen(name) {
  if (!name) return;
  _dbActive = "effectors";
  var input = document.getElementById("db-search");
  if (input) input.value = name;
  _dbRender();
  var section = document.getElementById("database");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function initDatabase() {
  var host = document.getElementById("db-tabs");
  if (!host) return;

  _dbNormalise();
  if (!_dbActive) _dbActive = DB_TABLES[0].id;
  // Stage 1 is the most natural opening table for the trafficking story.
  if (DB_TABLES[0].rows(TOOLKIT_DATA).length === 0) _dbActive = "maturation_stages";

  _dbRender();

  host.addEventListener("click", function (ev) {
    var btn = ev.target.closest ? ev.target.closest("[data-db-table]") : null;
    if (btn) _dbSelectTable(btn.getAttribute("data-db-table"));
  });

  var head = document.getElementById("db-head");
  if (head) {
    head.addEventListener("click", function (ev) {
      var th = ev.target.closest ? ev.target.closest("[data-db-sort]") : null;
      if (th) _dbSortBy(_dbActive, th.getAttribute("data-db-sort"));
    });
  }

  var search = document.getElementById("db-search");
  if (search) {
    var timer = null;
    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(_dbRender, 120);
    });
  }

  var dl = document.getElementById("db-download");
  if (dl) dl.addEventListener("click", _dbDownload);
}

/* data-loader.js populates TOOLKIT_DATA before calling the init chain, so
   hooking initToolkit keeps the tables in step with the rest of the page. */
var _origInitToolkit_db = initToolkit;
initToolkit = function () {
  if (_origInitToolkit_db) _origInitToolkit_db();
  initDatabase();
};

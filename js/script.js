/* ---------------------------------------------------------------------------
   Dark Mode
   --------------------------------------------------------------------------- */
function toggleDarkMode() {
  var isDark = document.documentElement.getAttribute("data-theme") === "dark";
  if (isDark) {
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("theme");
    document.getElementById("dark-toggle").innerHTML = "&#9790;";
  } else {
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem("theme", "dark");
    document.getElementById("dark-toggle").innerHTML = "&#9728;";
  }
}

(function initTheme() {
  var saved = localStorage.getItem("theme");
  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (saved === "dark" || (!saved && prefersDark)) {
    document.documentElement.setAttribute("data-theme", "dark");
    setTimeout(function() {
      var btn = document.getElementById("dark-toggle");
      if (btn) btn.innerHTML = "&#9728;";
    }, 0);
  }
})();

/* ---------------------------------------------------------------------------
   Mobile Navigation
   --------------------------------------------------------------------------- */
function toggleMobileNav() {
  var links = document.getElementById("nav-links");
  var burger = document.getElementById("hamburger");
  var overlay = document.getElementById("mobile-overlay");
  links.classList.toggle("open");
  burger.classList.toggle("open");
  overlay.classList.toggle("open");
}

function closeMobileNav() {
  var links = document.getElementById("nav-links");
  var burger = document.getElementById("hamburger");
  var overlay = document.getElementById("mobile-overlay");
  links.classList.remove("open");
  burger.classList.remove("open");
  overlay.classList.remove("open");
}

/* ---------------------------------------------------------------------------
   URL Deep-linking — ?pathogen=Name
   --------------------------------------------------------------------------- */
function handleDeepLink() {
  var params = new URLSearchParams(window.location.search);
  var name = params.get("pathogen");
  if (!name) return;
  var cards = document.querySelectorAll(".pathogen-card-sm");
  for (var i = 0; i < cards.length; i++) {
    var nameEl = cards[i].querySelector(".pathogen-name");
    if (nameEl && nameEl.textContent.trim().toLowerCase() === name.toLowerCase()) {
      var cardId = cards[i].id;
      setTimeout(function() {
        toggleAPCard(cardId, name);
        cards[i].scrollIntoView({ block: "center" });
      }, 600);
      break;
    }
  }
}

/* ---------------------------------------------------------------------------
   Card toggling (featured pathogens)
   --------------------------------------------------------------------------- */
function toggleCard(cardId) {
  var card = document.getElementById(cardId);
  if (!card) return;
  card.classList.toggle('expanded');
}

var timelineData = [
  {
    name: "Pre-Phagocytosis",
    markers: [
      { label: "Rab5 — cytosolic", type: "" },
      { label: "Rab7 — cytosolic", type: "" },
      { label: "LAMP1 — lysosomal", type: "" },
      { label: "Actin — cortical", type: "present" }
    ],
    changes: [
      "Receptor recognition (Fc-γR, CR3, mannose receptor) initiates signaling",
      "PI3K activation generates PI(4,5)P2 at the phagocytic cup",
      "Rac1 and Cdc42 trigger actin nucleation via Arp2/3 and formins",
      "Local membrane curvature driven by BAR-domain proteins"
    ],
    pathogens: [
      "Shigella (T3SS IpaB/C): begins translocon insertion before full internalization",
      "Listeria (InlA/InlB): triggers PI3K→Rac1 via Met receptor signaling",
      "Salmonella (SopE, SipA): activates Rac1/Cdc42 for actin ruffle formation"
    ]
  },
  {
    name: "Phagosome Formation",
    markers: [
      { label: "Rab5 — being recruited", type: "present" },
      { label: "LAMP1 — absent", type: "absent" },
      { label: "PI(3)P — being generated", type: "present" },
      { label: "EEA1 — absent", type: "absent" }
    ],
    changes: [
      "Pseudopod zippering seals around particle; plasma membrane pinches off",
      "PI(4,5)P2 converted to PI(3)P by class III PI3K (VPS34)",
      "Rab5 anchors to nascent phagosomal membrane",
      "Actin coat begins depolymerizing from sealed vacuole"
    ],
    pathogens: [
      "Listeria: LLO begins inserting into the forming phagosomal membrane",
      "Shigella: IpaB pore formation begins; may escape before full sealing",
      "Legionella: Dot/Icm T4SS begins effector translocation immediately upon entry"
    ]
  },
  {
    name: "Early Phagosome",
    markers: [
      { label: "Rab5 ✓", type: "present" },
      { label: "EEA1 ✓", type: "present" },
      { label: "Rab7 — absent", type: "absent" },
      { label: "LAMP1 — absent", type: "absent" }
    ],
    changes: [
      "pH ~6.5 — mildly acidic, V-ATPase partly active",
      "Early endosome fusion delivers transferrin receptor, recycling cargo",
      "PI(3)P enrichment recruits FYVE-domain effectors (EEA1, Rabenosyn-5)",
      "Rab5 effector complex (hVPS34/p150) maintains PI(3)P and compartment identity"
    ],
    pathogens: [
      "M. tuberculosis: SapM dephosphorylates PI(3)P; blocks Rab5→Rab7 switch",
      "Salmonella SPI-1: early SCV acquires Rab5 transiently; SPI-2 effectors then redirect",
      "Legionella: LCV rapidly acquires ER markers instead of early endosomal markers via DrrA/SidM"
    ]
  },
  {
    name: "Late Phagosome",
    markers: [
      { label: "Rab7 ✓", type: "present" },
      { label: "LAMP1 ✓", type: "present" },
      { label: "Rab5 — absent/decreasing", type: "absent" },
      { label: "V-ATPase ✓", type: "present" }
    ],
    changes: [
      "pH ~5.5 — significant acidification via V-ATPase",
      "Rab5→Rab7 switch mediated by Mon1–CCZ1 GEF complex",
      "LAMP1 acquisition via late endosome fusion",
      "Cathepsin D, cathepsin B begin import but remain largely inactive",
      "RILP recruits dynein; vacuole moves toward perinuclear lysosomes"
    ],
    pathogens: [
      "Salmonella: SifA/SKIP decouples LAMP1 acquisition from functional maturation",
      "Salmonella: SseJ deacylates membrane cholesterol to maintain SCV identity",
      "M. tuberculosis: tlyA and other lipids prevent full V-ATPase recruitment; pH stays ~6.4"
    ]
  },
  {
    name: "Phagolysosome",
    markers: [
      { label: "LAMP1 ✓✓", type: "present" },
      { label: "Cathepsins ✓", type: "present" },
      { label: "Rab7 — decreasing", type: "" },
      { label: "pH ~4.5", type: "present" }
    ],
    changes: [
      "pH ~4.5 — fully acidified; optimal for hydrolase activity",
      "Cathepsin B, D, L, S cleave proteins; lipases degrade bacterial membranes",
      "Reactive Oxygen Species (ROS) generated by NADPH oxidase",
      "Reactive Nitrogen Species (RNS) via iNOS contribute to killing",
      "Bactericidal peptides (defensins, lactoferricin) concentrated in lumen"
    ],
    pathogens: [
      "Most pathogens that reach this stage are killed — this is the canonical endpoint",
      "Coxiella burnetii (not profiled): uniquely thrives IN the phagolysosome at pH 4.5",
      "Pathogens like Mtb, Salmonella, Legionella act upstream to never reach this stage"
    ]
  }
];

var activeStage = null;

function activateStage(index) {
  var stages = document.querySelectorAll('.timeline-stage');
  var detail = document.getElementById('timeline-detail');

  if (activeStage === index) {
    stages[index].classList.remove('active');
    detail.classList.remove('visible');
    activeStage = null;
    return;
  }

  if (activeStage !== null) {
    stages[activeStage].classList.remove('active');
  }

  stages[index].classList.add('active');
  activeStage = index;

  var data = timelineData[index];

  document.getElementById('detail-stage-name').textContent = data.name;

  var markersEl = document.getElementById('detail-markers');
  markersEl.innerHTML = '';
  var map = _getProteinPathogens();
  data.markers.forEach(function(m) {
    var tag = document.createElement('span');
    tag.className = 'marker-tag' + (m.type ? ' ' + m.type : '');
    tag.textContent = m.label;
    // Check if this label matches a known host protein
    var label = m.label;
    var matched = false;
    var keys = Object.keys(map);
    for (var k = 0; k < keys.length; k++) {
      if (label.indexOf(keys[k]) !== -1) {
        tag.style.cursor = "pointer";
        tag.title = "Click to see which pathogens target " + keys[k];
        (function(prot) {
          tag.addEventListener("click", function(e) {
            e.stopPropagation();
            _showMarkerPathogens(prot, tag);
          });
        })(keys[k]);
        matched = true;
        break;
      }
    }
    markersEl.appendChild(tag);
  });

  var changesEl = document.getElementById('detail-changes');
  changesEl.innerHTML = '';
  data.changes.forEach(function(c) {
    var li = document.createElement('li');
    li.textContent = c;
    changesEl.appendChild(li);
  });

  var pathEl = document.getElementById('detail-pathogens');
  pathEl.innerHTML = '';
  data.pathogens.forEach(function(p) {
    var li = document.createElement('li');
    li.textContent = p;
    pathEl.appendChild(li);
  });

  detail.classList.add('visible');

  setTimeout(function() {
    detail.scrollIntoView({ block: 'nearest' });
  }, 80);
}

function closeTimeline() {
  var stages = document.querySelectorAll('.timeline-stage');
  var detail = document.getElementById('timeline-detail');

  if (activeStage !== null) {
    stages[activeStage].classList.remove('active');
    activeStage = null;
  }
  detail.classList.remove('visible');
  var info = document.getElementById("marker-pathogen-info");
  if (info) info.style.display = "none";
}

// Build host protein → pathogens lookup from effectors data
var _proteinPathogens = null;
function _getProteinPathogens() {
  if (_proteinPathogens) return _proteinPathogens;
  _proteinPathogens = {};
  var effs = TOOLKIT_DATA.effectors || [];
  effs.forEach(function(e) {
    var targets = [e.host_target];
    // Some effectors list multiple targets separated by " / " or "and"
    if (e.host_target) {
      targets = e.host_target.split(/ \/ | and /);
    }
    targets.forEach(function(t) {
      var key = t.trim();
      if (!key) return;
      if (!_proteinPathogens[key]) _proteinPathogens[key] = [];
      if (_proteinPathogens[key].indexOf(e.pathogen_name) === -1) {
        _proteinPathogens[key].push(e.pathogen_name);
      }
    });
  });
  return _proteinPathogens;
}

function _showMarkerPathogens(proteinName, el) {
  var map = _getProteinPathogens();
  var info = document.getElementById("marker-pathogen-info");
  if (!info) return;

  // Try exact match first, then partial
  var pathogens = map[proteinName];
  if (!pathogens || !pathogens.length) {
    // Try partial match: find a key contained in proteinName
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      if (proteinName.indexOf(keys[i]) !== -1) {
        pathogens = map[keys[i]];
        break;
      }
    }
  }
  if (!pathogens || !pathogens.length) {
    info.style.display = "none";
    return;
  }

  el.classList.add("clicked");
  info.innerHTML = "<div class='marker-pathogen-header'><strong>Pathogens targeting this marker:</strong> <span class='marker-pathogen-close' onclick='_hideMarkerPathogens()'>&times;</span></div>"
    + "<ul>" + pathogens.map(function(p) { return "<li>" + _escapeHtml(p) + "</li>"; }).join("") + "</ul>";
  info.style.display = "block";
}

function _hideMarkerPathogens() {
  var info = document.getElementById("marker-pathogen-info");
  if (info) info.style.display = "none";
  var tags = document.querySelectorAll(".marker-tag.clicked");
  tags.forEach(function(t) { t.classList.remove("clicked"); });
}

/* ---------------------------------------------------------------------------
   Toolkit — fully offline with embedded data; API is optional enhancement
   --------------------------------------------------------------------------- */

function _buildMarkerProfiles() {
  var profiles = {};
  TOOLKIT_DATA.stage_markers.forEach(function(sm) {
    if (!profiles[sm.stage_name]) profiles[sm.stage_name] = {};
    profiles[sm.stage_name][sm.host_protein_name] = sm.presence;
  });
  return profiles;
}

var _STAGE_PROFILES = null;
function _getStageProfiles() {
  if (!_STAGE_PROFILES) _STAGE_PROFILES = _buildMarkerProfiles();
  return _STAGE_PROFILES;
}

function initToolkit() {
  var mSel = document.getElementById("ml-pathogen-select");
  var checklist = document.getElementById("marker-checklist");
  if (!mSel && !checklist) return;

  var pathogenList = TOOLKIT_DATA.pathogens || [];
  var opts = pathogenList.map(function(p) {
    return '<option value="' + _escapeHtml(p.name) + '">' + _escapeHtml(p.name) + ' (' + _escapeHtml(p.strategy) + ')</option>';
  }).join("");
  if (mSel) mSel.insertAdjacentHTML("beforeend", opts);

  if (checklist) {
    checklist.innerHTML = (TOOLKIT_DATA.stage_marker_names || []).map(function(m) {
      return '<label><input type="checkbox" value="' + _escapeHtml(m) + '"> ' + _escapeHtml(m) + '</label>';
    }).join("");
  }
}

function showError(elId, msg) {
  var el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = '<div class="error">' + msg + '</div>';
}

function _stageResultFallback(observed, el) {
  var profiles = _getStageProfiles();
  var best = null, bestScore = -1;

  Object.keys(profiles).forEach(function(stage) {
    var profile = profiles[stage];
    var match = 0, total = 0;
    Object.keys(profile).forEach(function(marker) {
      if (observed[marker] !== undefined) {
        total++;
        if (observed[marker] === profile[marker]) match++;
      }
    });
    if (total > 0) {
      var score = match / total;
      if (score > bestScore) { bestScore = score; best = stage; }
    }
  });

  if (!best) {
    el.innerHTML = "<em>No matching stage. Try selecting different markers.</em>";
    return;
  }
  el.innerHTML = "<strong>Predicted stage:</strong> "
    + '<span class="badge badge-blue">' + _escapeHtml(best) + "</span>"
    + " &nbsp;(confidence: " + (bestScore * 100).toFixed(0) + "%)";
}

function predictStage() {
  var checked = document.querySelectorAll("#marker-checklist input:checked");
  var markers = Array.from(checked).map(function(cb) { return cb.value; });

  if (!markers.length) { showError("stage-result", "Select at least one marker."); return; }

  var el = document.getElementById("stage-result");
  if (!el) return;
  el.innerHTML = "<em>Predicting…</em>";

  fetch("/api/trafficking/predict-stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markers: markers })
  })
  .then(function(r) { if (!r.ok) throw new Error("API unavailable"); return r.json(); })
  .then(function(info) {
    var present = (info.markers_present || []).map(_escapeHtml).join(", ");
    el.innerHTML = "<strong>Predicted stage:</strong> "
      + '<span class="badge badge-blue">' + _escapeHtml(info.name) + "</span>"
      + "<br><small>pH " + _escapeHtml(String(info.ph_min)) + "–" + _escapeHtml(String(info.ph_max))
      + " · " + _escapeHtml(info.time_range)
      + " · Markers: " + present + "</small>";
  })
  .catch(function() {
    var observed = {};
    markers.forEach(function(m) { observed[m] = 1; });
    _stageResultFallback(observed, el);
  });
}

function predictStrategy() {
  var sel = document.getElementById("ml-pathogen-select");
  var name = sel ? sel.value : "";
  if (!name) { showError("ml-result", "Select a pathogen first."); return; }

  var el = document.getElementById("ml-result");
  if (!el) return;
  el.innerHTML = "<em>Predicting…</em>";

  fetch("/api/ml/predict/" + encodeURIComponent(name))
    .then(function (r) {
      if (!r.ok) throw new Error("ML API unavailable");
      return r.json();
    })
    .then(function (data) {
      var predicted = data.predicted_strategy;
      var actual = data.actual_strategy;
      var ok = predicted === actual ? "green" : "red";
      var pct = data.confidence ? (data.confidence * 100).toFixed(0) + "%" : "N/A";
      el.innerHTML = "<strong>Predicted:</strong> <span class='badge badge-" + ok + "'>" + _escapeHtml(predicted) + "</span>"
        + " &nbsp;| <strong>Actual:</strong> <span class='badge badge-blue'>" + _escapeHtml(actual) + "</span>"
        + " &nbsp;(confidence: " + pct + ")";
    })
    .catch(function () {
      // Fall back to static data
      var match = null;
      for (var i = 0; i < TOOLKIT_DATA.ml_predictions.length; i++) {
        if (TOOLKIT_DATA.ml_predictions[i].pathogen === name) {
          match = TOOLKIT_DATA.ml_predictions[i];
          break;
        }
      }
      if (!match) { el.innerHTML = "<em>No prediction available for " + _escapeHtml(name) + ".</em>"; return; }
      var predicted = match.predicted;
      var actual = match.actual;
      var ok = predicted === actual ? "green" : "red";
      el.innerHTML = "<strong>Predicted:</strong> <span class='badge badge-" + ok + "'>" + _escapeHtml(predicted) + "</span>"
        + " &nbsp;| <strong>Actual:</strong> <span class='badge badge-blue'>" + _escapeHtml(actual) + "</span>"
        + " &nbsp;(confidence: " + (match.confidence * 100).toFixed(0) + "%)";
    });
}

  function _downloadCSV(rows, columns, filename) {
    var cell = function (v) {
      return '"' + (v === undefined || v === null ? "" : String(v)).replace(/"/g, '""') + '"';
    };
    var header = columns.map(function(c) { return cell(c.label); }).join(",");
    var data = rows.map(function(r) {
      return columns.map(function(c) { return cell(r[c.key]); }).join(",");
    }).join("\n");
  var blob = new Blob([header + "\n" + data], { type: "text/csv;charset=utf-8;" });
  var link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/* ---------------------------------------------------------------------------
   Data Collection — dynamic grid
   --------------------------------------------------------------------------- */

var _allPathogensData = [];

// The curated dataset in TOOLKIT_DATA is the single source of truth. It is
// populated from js/data.js (embedded, works on file://) and refreshed from
// /api/bootstrap or data/fallback.json when a server is reachable.
function _sourceList() {
  return TOOLKIT_DATA.pathogens || [];
}

function _sourceEffectors() {
  return TOOLKIT_DATA.effectors || [];
}

function _sourceMlPredictions() {
  return TOOLKIT_DATA.ml_predictions || [];
}

// Real PubMed references fetched from NCBI E-utilities by
// scripts/fetch_literature.py and exported into the offline payload.
function _sourceLiterature() {
  return TOOLKIT_DATA.literature || [];
}

/* ---------------------------------------------------------------------------
   Maturation timeline tour — builds the stage buttons consumed by
   activateStage()/closeTimeline() from the timelineData definitions.
   --------------------------------------------------------------------------- */
function buildMaturationTimeline() {
  var container = document.getElementById("maturation-timeline");
  if (!container || !timelineData || !timelineData.length) return;
  var times = ["Pre-contact", "t \u2248 0", "t = 5\u201315 min", "t = 20\u201360 min", "t > 1 h"];
  container.innerHTML = timelineData.map(function (stage, i) {
    return '<button type="button" class="timeline-stage" onclick="activateStage(' + i + ')" aria-label="Show stage: ' + _escapeHtml(stage.name) + '">' +
      '<span class="stage-dot">' + (i + 1) + "</span>" +
      '<span class="stage-name">' + _escapeHtml(stage.name) + "</span>" +
      '<span class="stage-time">' + _escapeHtml(times[i] || "") + "</span>" +
      "</button>";
  }).join("");
}

/* ---------------------------------------------------------------------------
   Gene & Protein Explorer — host proteome cards with pathway/localization
   filters and effector/pathogen targeting statistics.
   --------------------------------------------------------------------------- */
var _protTargetMap = null;

// Effectors can list several host targets in one cell, separated by "/",
// "and", ";" or a comma.
function splitHostTargets(v) {
  return String(v == null ? "" : v)
    .split(/\s*(?:\/|\band\b|;|,)\s*/i)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

function _getProtTargetMap() {
  if (_protTargetMap) return _protTargetMap;
  var map = {};
  (TOOLKIT_DATA.effectors || []).forEach(function (e) {
    splitHostTargets(e.host_target).forEach(function (t) {
      var key = String(t).trim();
      if (!key) return;
      if (!map[key]) map[key] = { pathogens: {}, effectors: 0 };
      map[key].pathogens[e.pathogen_name] = (map[key].pathogens[e.pathogen_name] || 0) + 1;
      map[key].effectors++;
    });
  });
  _protTargetMap = map;
  return map;
}

function _resetProtCache() {
  _protTargetMap = null;
}

function initProteinExplorer() {
  _resetProtCache();
  var grid = document.getElementById("proteome-grid");
  if (!grid) return;
  var pathwaySel = document.getElementById("prot-pathway");
  var locSel = document.getElementById("prot-localization");
  var proteins = TOOLKIT_DATA.host_proteins || [];

  var pw = {}, locs = {};
  proteins.forEach(function (h) {
    var p = h.pathway || h.full_pathway || "Other";
    if (!pw[p]) pw[p] = true;
    var l = h.localization || "Not annotated";
    if (!locs[l]) locs[l] = true;
  });
  var pwKeys = Object.keys(pw).sort();
  var locKeys = Object.keys(locs).sort();

  if (pathwaySel && (pathwaySel.options.length !== pwKeys.length + 1)) {
    pathwaySel.innerHTML = '<option value="">All pathways</option>' + pwKeys.map(function (c) {
      return '<option value="' + _escapeHtml(c) + '">' + _escapeHtml(c) + "</option>";
    }).join("");
  }
  if (locSel && (locSel.options.length !== locKeys.length + 1)) {
    locSel.innerHTML = '<option value="">All localizations</option>' + locKeys.map(function (c) {
      return '<option value="' + _escapeHtml(c) + '">' + _escapeHtml(c) + "</option>";
    }).join("");
  }
  filterHostProteins();
}

function filterHostProteins() {
  var grid = document.getElementById("proteome-grid");
  if (!grid) return;
  var q = (document.getElementById("prot-search") ? document.getElementById("prot-search").value : "").toLowerCase();
  var pw = document.getElementById("prot-pathway") ? document.getElementById("prot-pathway").value : "";
  var loc = document.getElementById("prot-localization") ? document.getElementById("prot-localization").value : "";

  var proteins = (TOOLKIT_DATA.host_proteins || []).filter(function (h) {
    var hay = (h.name + " " + (h.full_name || "") + " " + (h.function || "")).toLowerCase();
    if (q && hay.indexOf(q) === -1) return false;
    if (pw && (h.pathway || h.full_pathway || "Other") !== pw) return false;
    if (loc && (h.localization || "Not annotated") !== loc) return false;
    return true;
  });

  var map = _getProtTargetMap();
  var countEl = document.getElementById("proteome-count");
  if (countEl) countEl.textContent = proteins.length + " host protein" + (proteins.length === 1 ? "" : "s");

  grid.innerHTML = proteins.map(function (h) {
    var t = map[h.name];
    var eCount = t ? t.effectors : 0;
    var pNames = t ? Object.keys(t.pathogens).sort() : [];
    var chips = pNames.slice(0, 5).map(function (p) {
      return '<span class="prot-pathogen-chip">' + _escapeHtml(p) + "</span>";
    });
    if (pNames.length > 5) chips.push('<span class="prot-pathogen-chip">+' + (pNames.length - 5) + " more</span>");
    return '<div class="proteome-card">' +
      "<h4>" + _escapeHtml(h.name) + "</h4>" +
      '<div class="proteome-fullname">' + _escapeHtml(h.full_name || "") + "</div>" +
      '<p class="proteome-function">' + _escapeHtml(h.function || "No annotation available.") + "</p>" +
      '<div class="proteome-meta">' +
      '<span class="prot-tag">' + _escapeHtml(h.pathway || h.full_pathway || "Other") + "</span>" +
      '<span class="prot-tag prot-loc">' + _escapeHtml(h.localization || "Not annotated") + "</span>" +
      "</div>" +
      '<div class="proteome-targets">' +
      '<span class="prot-strong">' + eCount + " effector" + (eCount === 1 ? "" : "s") + "</span>" +
      " from " + pNames.length + " pathogen" + (pNames.length === 1 ? "" : "s") + " target this protein" +
      '<div class="prot-pathogen-map">' + chips.join("") + "</div>" +
      "</div>" +
      "</div>";
  }).join("") || "<em>No host proteins match these filters. Try clearing the search or filters.</em>";
}

function renderAllPathogens() {
  var container = document.getElementById("all-pathogens-container");
  if (!container) return;
  var list = _sourceList();
  var effMap = _getEffectorMap();
  _allPathogensData = list.slice();
  _renderPathogenGrid(list, effMap, container);
  var cnt = document.getElementById("all-pathogen-count");
  if (cnt) cnt.textContent = list.length;
}

function _strategyBorder(strat) {
  if (strat === "escape") return "ap-border-escape";
  if (strat === "arrest") return "ap-border-arrest";
  if (strat === "reroute") return "ap-border-reroute";
  if (strat === "modified_compartment") return "ap-border-modified";
  return "ap-border-extracellular";
}

// Escape HTML special characters to prevent XSS
function _escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function _renderPathogenGrid(list, effMap, container) {
  var fragment = document.createDocumentFragment();
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    var nEff = effMap[p.name];
    if (nEff === undefined) nEff = typeof p.n_effectors === "number" ? p.n_effectors : "?";
    var gramBadge = "badge-blue";
    if (p.gram_stain === "Gram-positive") gramBadge = "badge-amber";
    else if (p.gram_stain === "Acid-fast") gramBadge = "badge-acid";
    else if (p.gram_stain === "Gram-negative") gramBadge = "badge-purple";
    var stratBadge = "badge-gray";
    if (p.strategy === "escape") stratBadge = "badge-red";
    else if (p.strategy === "arrest") stratBadge = "badge-amber";
    else if (p.strategy === "reroute") stratBadge = "badge-green";
    else if (p.strategy === "modified_compartment") stratBadge = "badge-purple";
    var cardId = "ap-card-" + i;
    var borderCls = _strategyBorder(p.strategy);

    var card = document.createElement("div");
    card.className = "pathogen-card pathogen-card-sm " + borderCls;
    card.id = cardId;

    var safeName = _escapeHtml(p.name);
    var safeCardId = _escapeHtml(cardId);
    card.innerHTML =
      '<div class="pathogen-card-top" onclick="toggleAPCard(\'' + safeCardId + '\',' + i + ')">'
      + '<div class="pathogen-meta">'
      + '<span class="badge ' + gramBadge + '">' + _escapeHtml(p.gram_stain || "\u2014") + '</span>'
      + '<span class="badge ' + stratBadge + '">' + _escapeHtml(p.strategy || "\u2014") + '</span>'
      + '<span class="badge badge-gray">' + nEff + ' effectors</span>'
      + '</div>'
      + '<div class="pathogen-name">' + safeName + '</div>'
      + '<div class="pathogen-class">' + _escapeHtml(p.species || "") + '</div>'
      + '<div class="pathogen-desc">' + _escapeHtml(p.description || "") + '</div>'
      + (p.reference ? '<div class="pathogen-ref">DOI: <a href="https://doi.org/' + _escapeHtml(p.reference) + '" target="_blank" rel="noopener noreferrer">' + _escapeHtml(p.reference) + '</a></div>' : '')
      + '</div>'
      + '<div class="pathogen-toggle" onclick="toggleAPCard(\'' + safeCardId + '\',' + i + ')"><span>Read Article <span class="toggle-arrow">&#9654;</span></span></div>'
      + '<div class="pathogen-panel"><div class="panel-article" id="' + safeCardId + '-article"><em>Loading\u2026</em></div></div>';

    fragment.appendChild(card);
  }
  container.innerHTML = "";
  container.appendChild(fragment);
}

function toggleAPCard(cardId, nameOrIndex) {
  var card = document.getElementById(cardId);
  if (!card) return;
  var wasExpanded = card.classList.contains("expanded");
  card.classList.toggle("expanded");
  if (!wasExpanded) {
    var articleDiv = document.getElementById(cardId + "-article");
    if (articleDiv && !articleDiv.dataset.loaded) {
      var p = null;
      var name = nameOrIndex;
      if (typeof nameOrIndex === "number") {
        p = _allPathogensData[nameOrIndex] || null;
        name = p ? p.name : null;
      }
      if (!p) {
        var allP = TOOLKIT_DATA.pathogens || [];
        for (var pi = 0; pi < allP.length; pi++) {
          if (allP[pi].name === name) { p = allP[pi]; break; }
        }
      }
      var effs = (_sourceEffectors() || []).filter(function(e) { return e.pathogen_name === name; });
      var targets = {};
      effs.forEach(function(e) {
        if (e.host_target) {
          var parts = e.host_target.split(/ \/ | and /);
          parts.forEach(function(t) { var k = t.trim(); if (k) targets[k] = (targets[k] || 0) + 1; });
        }
      });
      var targetKeys = Object.keys(targets);
      var mlPred = null;
      var mlAll = _sourceMlPredictions();
      for (var mi = 0; mi < mlAll.length; mi++) {
        if (mlAll[mi].pathogen === name) { mlPred = mlAll[mi]; break; }
      }

      var html = '<div class="panel-title">' + _escapeHtml(name) + ' — Pathogen Article</div>';

      // Description section
      html += '<div class="article-section"><h4>Overview</h4><p>' + _escapeHtml(p ? p.description : "") + '</p></div>';

      // Classification
      html += '<div class="article-section"><h4>Classification</h4><p><strong>Gram stain:</strong> ' + _escapeHtml(p ? p.gram_stain : "—")
        + ' &nbsp;|&nbsp; <strong>Strategy:</strong> ' + _escapeHtml(p ? p.strategy : "—")
        + ' &nbsp;|&nbsp; <strong>Effectors:</strong> ' + effs.length
        + (p && p.reference ? ' &nbsp;|&nbsp; <strong>DOI:</strong> <a href="https://doi.org/' + _escapeHtml(p.reference) + '" target="_blank" rel="noopener noreferrer">' + _escapeHtml(p.reference) + '</a>' : '')
        + '</p></div>';

      // Host targets
      if (targetKeys.length) {
        html += '<div class="article-section"><h4>Host Targets <span class="badge badge-gray">' + targetKeys.length + ' unique</span></h4><ul class="target-list">';
        targetKeys.sort().forEach(function(t) {
          html += '<li><span class="target-protein">' + _escapeHtml(t) + '</span> <span class="target-count">(' + targets[t] + ' effectors)</span></li>';
        });
        html += '</ul></div>';
      }

      // Effectors table
      if (effs.length) {
        html += '<div class="article-section"><h4>Effector Repertoire</h4><table><thead><tr><th>Effector</th><th>Type</th><th>Host Target</th><th>Mechanism</th></tr></thead><tbody>';
        effs.forEach(function(e) {
          html += "<tr><td>" + _escapeHtml(e.effector_name) + "</td><td>" + _escapeHtml(e.type || "—") + "</td><td>" + _escapeHtml(e.host_target || "—") + "</td><td>" + _escapeHtml(e.mechanism || "—") + "</td></tr>";
        });
        html += '</tbody></table></div>';
      }

      // Literature (real PubMed records; links open in a new tab)
      var lit = _sourceLiterature().filter(function(l) {
        return (l.pathogen_name || l.pathogen) === name;
      });
      if (lit.length) {
        html += '<div class="article-section"><h4>Literature <span class="badge badge-gray">' + lit.length + '</span></h4><ul class="literature-list">';
        lit.forEach(function(l) {
          var pmid = l.pubmed_id || "";
          var url = l.pubmed_url || (pmid ? "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/" : "");
          var cite = _escapeHtml(l.authors || "") + (l.year ? " (" + _escapeHtml(l.year) + ")" : "");
          html += '<li class="literature-item">'
            + '<a class="literature-title" href="' + _escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + _escapeHtml(l.title || "") + '</a>'
            + '<div class="literature-cite"><em>' + _escapeHtml(l.journal || "") + '</em>' + (cite ? " \u2014 " + cite : "") + '</div>'
            + '<div class="literature-pmid">PMID: <a href="' + _escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + _escapeHtml(pmid) + '</a></div>'
            + '</li>';
        });
        html += '</ul></div>';
      }

      // ML prediction
      if (mlPred) {
        var ok = mlPred.predicted === mlPred.actual ? "green" : "red";
        html += '<div class="article-section"><h4>ML Strategy Prediction</h4><p>'
          + 'Predicted: <span class="badge badge-' + ok + '">' + _escapeHtml(mlPred.predicted) + '</span>'
          + ' &nbsp;|&nbsp; Actual: <span class="badge badge-blue">' + _escapeHtml(mlPred.actual) + '</span>'
          + ' &nbsp;|&nbsp; Confidence: ' + (mlPred.confidence * 100).toFixed(0) + '%'
          + '</p></div>';
      }

      articleDiv.innerHTML = html;
      articleDiv.dataset.loaded = "1";
    }
  }
}

// Pre-computed effector map (computed once, not on every keystroke)
var _effectorMap = null;
function _getEffectorMap() {
  if (_effectorMap) return _effectorMap;
  _effectorMap = {};
  (_sourceEffectors() || []).forEach(function(e) {
    _effectorMap[e.pathogen_name] = (_effectorMap[e.pathogen_name] || 0) + 1;
  });
  return _effectorMap;
}

// Debounce utility
var _filterTimeout = null;
function debouncedFilterPathogens() {
  if (_filterTimeout) clearTimeout(_filterTimeout);
  _filterTimeout = setTimeout(filterAllPathogens, 150);
}

function filterAllPathogens() {
  var q = (document.getElementById("ap-search").value || "").toLowerCase();
  var strat = document.getElementById("ap-strategy").value;
  var gram = document.getElementById("ap-gram").value;
  var filtered = _allPathogensData.filter(function(p) {
    if (q && p.name.toLowerCase().indexOf(q) === -1
      && (p.species || "").toLowerCase().indexOf(q) === -1
      && (p.description || "").toLowerCase().indexOf(q) === -1) return false;
    if (strat && p.strategy !== strat) return false;
    if (gram && p.gram_stain !== gram) return false;
    return true;
  });
  var effMap = _getEffectorMap();
  var container = document.getElementById("all-pathogens-container");
  if (container) _renderPathogenGrid(filtered, effMap, container);
}

// Hook into the existing init
var _origInitToolkit = initToolkit;
initToolkit = function() {
  if (_origInitToolkit) _origInitToolkit();
  renderAllPathogens();
  buildMaturationTimeline();
  initProteinExplorer();
};

// Init is now triggered by data-loader.js after API data is fetched



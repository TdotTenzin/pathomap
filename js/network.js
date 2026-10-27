/* ---------------------------------------------------------------------------
   Interactive Interactome Network — force-directed graph
   Visualizes the bipartite host-pathogen interaction network: selected
   pathogen's effectors (left) targeting host proteins (right).

   Built client-side from TOOLKIT_DATA.effectors so it works fully offline.
   Uses D3 v7 (loaded from CDN with a local fallback).
   --------------------------------------------------------------------------- */

var _networkGraphRendered = false;
var _networkSim = null;

/* Build a {nodes, edges} graph from the active effector source for a pathogen */
function _buildNetworkData(pathogenName) {
  var effs = (_sourceEffectors() || []).filter(function(e) {
    return e.pathogen_name === pathogenName;
  });

  var nodes = [];
  var edges = [];
  var nodeById = {};
  var hostSet = {};

  function addNode(id, label, type, opts) {
    if (nodeById[id]) return nodeById[id];
    var n = { id: id, label: label, type: type, degree: 0 };
    if (opts) {
      Object.keys(opts).forEach(function(k) { n[k] = opts[k]; });
    }
    nodeById[id] = n;
    nodes.push(n);
    return n;
  }

  effs.forEach(function(e) {
    var eid = "E:" + e.effector_name;
    var targetList = [e.host_target];
    if (e.host_target) {
      targetList = e.host_target.split(/ \/ | and /).map(function(t) { return t.trim(); });
    }
    targetList = targetList.filter(function(t) { return t; });

    addNode(eid, e.effector_name, "effector", { type: e.type || "", mechanism: e.mechanism || "" });

    targetList.forEach(function(t) {
      var hid = "H:" + t;
      // Don't create host nodes for vague/non-protein targets
      var vague = /membrane|surfaces?|cells?|immune|apoptosis|signal|iron|glycans|DNA|ROS|claudins|adhesion/i.test(t);
      if (vague) return;
      addNode(hid, t, "host");
      edges.push({ source: eid, target: hid });
      nodeById[eid].degree += 1;
      nodeById[hid].degree += 1;
    });
  });

  return { nodes: nodes, edges: edges, pathogens: effs.length ? [pathogenName] : [] };
}

function initNetworkSection() {
  refreshNetworkSection();
}

function refreshNetworkSection() {
  var select = document.getElementById("interactome-select");
  if (!select) return;
  var prev = select.value;
  var list = _sourceList() || [];

  select.innerHTML = "";
  var empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "— Select a pathogen —";
  select.appendChild(empty);
  list.forEach(function(p) {
    var o = document.createElement("option");
    o.value = p.name;
    o.textContent = p.name;
    select.appendChild(o);
  });

  var stillThere = false;
  for (var i = 0; i < list.length; i++) { if (list[i].name === prev) { stillThere = true; break; } }
  var target = stillThere ? prev : (list.length ? list[0].name : "");
  select.value = target;

  _populateNetworkCompare(list);

  if (target) {
    loadNetworkGraph(target);
  } else {
    var placeholder = document.getElementById("select-pathogen-hint");
    if (placeholder) placeholder.style.display = "block";
    var container = document.getElementById("interactome-graph");
    if (container) container.innerHTML = "";
  }
}

function _populateNetworkCompare(list) {
  ["network-compare-a", "network-compare-b"].forEach(function(id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = "<option value=''>— Select —</option>";
    list.forEach(function(p) {
      var o = document.createElement("option");
      o.value = p.name;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;
  });
}

function loadNetworkGraph(pathogenName) {
  var container = document.getElementById("interactome-graph");
  if (!container) return;

  var placeholder = document.getElementById("select-pathogen-hint");
  if (pathogenName && placeholder) placeholder.style.display = "none";

  renderNetworkMetrics(pathogenName);

  var data = _buildNetworkData(pathogenName);
  container.innerHTML = "";

  if (!data.nodes.length) {
    container.innerHTML = "<p class='network-empty'>No effector–host interactions available for this pathogen.</p>";
    return;
  }

  if (typeof d3 === "undefined") {
    container.innerHTML = "<p class='network-empty'>Network visualization requires D3.js, which could not be loaded. Please check your connection.</p>";
    return;
  }

  drawNetwork(container, data, pathogenName);
}

function drawNetwork(container, data, pathogenName) {
  // Clear existing simulation
  if (_networkSim) { _networkSim.stop(); }

  var width = container.clientWidth || 820;
  var height = 560;

  var svg = d3.select(container)
    .append("svg")
    .attr("width", "100%")
    .attr("height", height)
    .attr("viewBox", "0 0 " + width + " " + height)
    .style("background", "transparent")
    .style("display", "block");

  var defs = svg.append("defs");
  defs.append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 22)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#94a3b8");

  var pathogenIdx = (_sourceList() || []).findIndex(function(p) { return p.name === pathogenName; });
  var pathogenColor = _colorForPathogen(pathogenName, pathogenIdx < 0 ? 0 : pathogenIdx);

  var links = svg.append("g")
    .attr("class", "network-links")
    .selectAll("line")
    .data(data.edges)
    .enter()
    .append("line")
    .attr("stroke", "#cbd5e1")
    .attr("stroke-opacity", 0.7)
    .attr("stroke-width", 1.2);

  var linkLabels = svg.append("g")
    .attr("class", "network-link-labels")
    .selectAll("text")
    .data(data.edges)
    .enter()
    .append("text")
    .attr("text-anchor", "middle")
    .attr("font-size", 9)
    .attr("fill", "#64748b")
    .text("targets")
    .style("display", "none");

  var node = svg.append("g")
    .attr("class", "network-nodes")
    .selectAll("g")
    .data(data.nodes)
    .enter()
    .append("g")
    .call(d3.drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended));

  node.append("circle")
    .attr("r", function(d) { return d.type === "effector" ? 10 : 8; })
    .attr("fill", function(d) { return d.type === "effector" ? pathogenColor : "#3b82f6"; })
    .attr("stroke", "#fff")
    .attr("stroke-width", 2)
    .style("cursor", "pointer");

  node.append("text")
    .attr("dx", function(d) { return d.type === "effector" ? 14 : -14; })
    .attr("dy", ".35em")
    .attr("text-anchor", function(d) { return d.type === "effector" ? "start" : "end"; })
    .attr("font-size", 11)
    .attr("font-weight", 600)
    .attr("fill", function(d) { return d.type === "effector" ? "#1e293b" : "#2563eb"; })
    .style("paint-order", "stroke")
    .style("stroke", function() {
      return document.documentElement.getAttribute("data-theme") === "dark" ? "#0f172a" : "#ffffff";
    })
    .style("stroke-width", 3)
    .text(function(d) { return d.label; });

  node.append("title")
    .text(function(d) {
      if (d.type === "effector") {
        return d.label + "\nEffector (" + (d.type || "unknown type") + ")\n" + (d.mechanism || "");
      }
      return d.label + "\nHost protein targeted";
    });

  // Tooltip div
  var tooltip = d3.select(container.parentNode)
    .append("div")
    .attr("class", "network-tooltip")
    .style("opacity", 0);

  node.on("mouseover", function(event, d) {
    highlightConnections(d, true);
    tooltip.transition().duration(150).style("opacity", 1);
    tooltip
      .html(_tooltipHTML(d))
      .style("left", (event.pageX + 12) + "px")
      .style("top", (event.pageY - 12) + "px");
  })
  .on("mousemove", function(event) {
    tooltip
      .style("left", (event.pageX + 12) + "px")
      .style("top", (event.pageY - 12) + "px");
  })
  .on("mouseout", function() {
    highlightConnections(null, false);
    tooltip.transition().duration(200).style("opacity", 0);
  });

  function _tooltipHTML(d) {
    var html = "<div class='network-tooltip-title'>" + d.label + "</div>";
    if (d.type === "effector") {
      html += "<div>Type: " + (d.type || "—") + "</div>";
      if (d.mechanism) html += "<div>Mechanism: " + d.mechanism + "</div>";
    } else {
      html += "<div>Targeted by <strong>" + d.degree + "</strong> effector(s)</div>";
    }
    return html;
  }

  function highlightConnections(activeNode, on) {
    node.select("circle").attr("opacity", 1);
    links.attr("stroke-opacity", 0.7).attr("stroke-width", 1.2);

    if (!activeNode) return;
    var connected = {};
    connected[activeNode.id] = true;
    data.edges.forEach(function(e) {
      if (e.source.id === activeNode.id) connected[e.target.id] = true;
      if (e.target.id === activeNode.id) connected[e.source.id] = true;
    });
    node.classed("dimmed", function(d) { return on && !connected[d.id]; });

    links.attr("stroke-opacity", function(d) {
      var adjacent = on && (d.source.id === activeNode.id || d.target.id === activeNode.id);
      return adjacent ? 1 : (on ? 0.15 : 0.7);
    }).attr("stroke-width", function(d) {
      return on && (d.source.id === activeNode.id || d.target.id === activeNode.id) ? 2.5 : 1.2;
    });

    if (on) {
      linkLabels.style("display", function(d) {
        return (d.source.id === activeNode.id || d.target.id === activeNode.id) ? "block" : "none";
      });
    } else {
      linkLabels.style("display", "none");
    }
  }

  var simulation = d3.forceSimulation(data.nodes)
    .force("link", d3.forceLink(data.edges).id(function(d) { return d.id; }).distance(120))
    .force("charge", d3.forceManyBody().strength(-320))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(24))
    .force("x", function() {
      var force = d3.forceX(function(d) { return d.type === "effector" ? width * 0.3 : width * 0.7; }).strength(0.12);
      return force;
    }());

  _networkSim = simulation;

  simulation.on("tick", function() {
    // Keep nodes in bounds
    data.nodes.forEach(function(n) {
      n.x = Math.max(20, Math.min(width - 20, n.x));
      n.y = Math.max(20, Math.min(height - 20, n.y));
    });
    links
      .attr("x1", function(d) { return d.source.x; })
      .attr("y1", function(d) { return d.source.y; })
      .attr("x2", function(d) { return d.target.x; })
      .attr("y2", function(d) { return d.target.y; });
    linkLabels
      .attr("x", function(d) { return (d.source.x + d.target.x) / 2; })
      .attr("y", function(d) { return (d.source.y + d.target.y) / 2; });
    node.attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; });
  });

  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
  }
  function dragged(event, d) {
    d.fx = event.x; d.fy = event.y;
  }
  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null; d.fy = null;
  }

  _renderNetworkLegend(svg, pathogenName, pathogenColor, width);
}

function _renderNetworkLegend(svg, pathogenName, color, width) {
  var legend = svg.append("g")
    .attr("transform", "translate(0, 14)")
    .attr("class", "network-legend");

  var items = [
    { label: "Effectors (" + pathogenName + ")", color: color, shape: "circle" },
    { label: "Host proteins", color: "#3b82f6", shape: "circle" }
  ];
  var x = 14;
  items.forEach(function(item) {
    var g = legend.append("g").attr("transform", "translate(" + x + ", 0)");
    g.append("circle").attr("r", 5).attr("fill", item.color).attr("stroke", "#fff").attr("stroke-width", 1.5);
    g.append("text")
      .attr("x", 12).attr("y", 4)
      .attr("font-size", 11).attr("fill", "#64748b")
      .text(item.label);
    x += 26 + 10 * item.label.length;
  });

  var stats = legend.append("g").attr("transform", "translate(" + (width - 14) + ", 0)").attr("text-anchor", "end");
  stats.append("text")
    .attr("font-size", 11).attr("fill", "#94a3b8")
    .text("Drag nodes to explore · hover to highlight");
}

/* ---------------------------------------------------------------------------
   Advanced network metrics panel (task 9)

   Basic topology is computed locally so it works offline; the richer metrics
   (betweenness, closeness, eigenvector, clustering, modularity) come from the
   live API endpoint /api/interactome/metrics/{pathogen}.
   --------------------------------------------------------------------------- */

function _localNetworkMetrics(pathogenName) {
  var data = _buildNetworkData(pathogenName);
  var n = data.nodes.length;
  var e = data.edges.length;
  var eff = data.nodes.filter(function(d) { return d.type === "effector"; }).length;
  return {
    n_nodes: n,
    n_effectors: eff,
    n_hosts: n - eff,
    n_edges: e,
    density: n > 1 ? (2 * e) / (n * (n - 1)) : 0,
    avg_degree: n ? (2 * e) / n : 0
  };
}

function _fmt(x, digits) {
  if (x === null || x === undefined) return "—";
  return (typeof x === "number") ? x.toFixed(digits === undefined ? 3 : digits) : String(x);
}

function _metricsHTML(pathogenName, local, live) {
  var rows = [
    ["Nodes", local.n_nodes],
    ["Effectors", local.n_effectors],
    ["Host proteins", local.n_hosts],
    ["Edges (interactions)", local.n_edges],
    ["Density", _fmt(local.density)],
    ["Avg. degree", _fmt(local.avg_degree, 2)]
  ];
  if (live) {
    rows.push(["Avg. clustering", _fmt(live.avg_clustering)]);
    rows.push(["Communities", live.n_communities]);
    rows.push(["Modularity", _fmt(live.modularity)]);
    rows.push(["Degree assortativity", _fmt(live.assortativity)]);
  }
  var html = "<h4 class='network-metrics-title'>Network metrics &mdash; " + pathogenName + "</h4>";
  html += "<table class='network-metrics-table'><tbody>";
  rows.forEach(function(r) {
    html += "<tr><th>" + r[0] + "</th><td>" + r[1] + "</td></tr>";
  });
  html += "</tbody></table>";

  if (live && live.top_betweenness && live.top_betweenness.length) {
    html += "<p class='network-metrics-sub'>Top nodes by betweenness centrality</p>";
    html += "<table class='network-metrics-table'><thead><tr><th>Node</th><th>Type</th>" +
            "<th>Betweenness</th><th>Degree</th></tr></thead><tbody>";
    live.top_betweenness.slice(0, 8).forEach(function(r) {
      html += "<tr><td>" + r.node + "</td><td>" + r.type + "</td><td>" +
              _fmt(r.betweenness, 4) + "</td><td>" + r.degree + "</td></tr>";
    });
    html += "</tbody></table>";
  } else if (!live) {
    html += "<p class='network-metrics-note'>Betweenness, closeness, clustering and " +
            "modularity are computed by the live API and are unavailable offline.</p>";
  }
  return html;
}

function renderNetworkMetrics(pathogenName) {
  var box = document.getElementById("network-metrics");
  if (!box) return;
  if (!pathogenName) { box.innerHTML = ""; return; }

  var local = _localNetworkMetrics(pathogenName);
  box.innerHTML = _metricsHTML(pathogenName, local, null);

  fetch("/api/interactome/metrics/" + encodeURIComponent(pathogenName))
    .then(function(r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); })
    .then(function(live) { box.innerHTML = _metricsHTML(pathogenName, local, live); })
    .catch(function() { /* offline: keep the local basics */ });
}

function compareSelectedNetworks() {
  var a = document.getElementById("network-compare-a");
  var b = document.getElementById("network-compare-b");
  var out = document.getElementById("network-compare-result");
  if (!a || !b || !out) return;
  if (!a.value || !b.value) { out.textContent = "Select two pathogens to compare."; return; }

  out.textContent = "Comparing…";
  fetch("/api/interactome/compare?pathogen_a=" + encodeURIComponent(a.value) +
        "&pathogen_b=" + encodeURIComponent(b.value))
    .then(function(r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); })
    .then(function(res) {
      var c = res.comparison;
      out.innerHTML =
        "<table class='network-metrics-table'><tbody>" +
        "<tr><th>Node Jaccard</th><td>" + _fmt(c.node_jaccard) + "</td></tr>" +
        "<tr><th>Edge Jaccard</th><td>" + _fmt(c.edge_jaccard) + "</td></tr>" +
        "<tr><th>Shared nodes</th><td>" + c.common_nodes + "</td></tr>" +
        "<tr><th>Shared edges</th><td>" + c.shared_edges + "</td></tr>" +
        "<tr><th>Shared-neighbour similarity</th><td>" + _fmt(c.shared_neighbor_similarity) + "</td></tr>" +
        "<tr><th>Graph edit distance</th><td>" +
          (c.graph_edit_distance === null ? (c.graph_edit_distance_note || "n/a") : c.graph_edit_distance) +
        "</td></tr>" +
        "</tbody></table>";
    })
    .catch(function() {
      out.textContent = "Network comparison requires the live API and is unavailable offline.";
    });
}

// Hook into init
var _origInitToolkit_net = initToolkit;
initToolkit = function() {
  if (_origInitToolkit_net) _origInitToolkit_net();
  initNetworkSection();
};

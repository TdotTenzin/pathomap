/* ---------------------------------------------------------------------------
   figure-export.js — publication-oriented figure export.

   Adds "PNG" buttons to every Chart.js canvas and "SVG"/"PNG" buttons to the
   D3 visualisations (interactome network, effector phylogeny). Exports are
   stamped with a metadata footer (dataset version, date, optional parameters)
   so a downloaded figure is self-describing.

   Chart PNGs are rendered at a multiple of the on-screen resolution
   (pixel-scaled, not a true physical 300 DPI). D3 figures export losslessly as
   SVG; their PNG path rasterises the same SVG.

   No external dependencies; works offline.
   --------------------------------------------------------------------------- */

var PATHOMAP_VERSION = (
  typeof TOOLKIT_DATA !== "undefined" && TOOLKIT_DATA.meta && TOOLKIT_DATA.meta.version
) || "0.4.0";

function pathomapVersion() {
  return PATHOMAP_VERSION;
}

/* Lower-case, underscore-safe filename fragment. */
function _safeName(s) {
  return String(s == null ? "" : s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/* Self-describing footer: version, ISO date, and any parameters. */
function figureMetaText(opts) {
  opts = opts || {};
  var date = opts.date || new Date().toISOString().slice(0, 10);
  var parts = ["PathoMap v" + pathomapVersion(), date];
  if (opts.params) parts.push(String(opts.params));
  return parts.join(" \u00b7 ");
}

function _downloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

/* Rasterise an existing canvas to a white-background PNG at `scale`, with a
   metadata footer strip beneath the figure. */
function exportChartPNG(canvasId, title, opts) {
  opts = opts || {};
  var src = document.getElementById(canvasId);
  if (!src || typeof src.getContext !== "function") return false;

  var w = src.width;
  var h = src.height;
  if (!w || !h) return false;

  var scale = opts.scale || 2;
  var footerH = Math.round(26 * scale);
  var out = document.createElement("canvas");
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale) + footerH;

  var ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0, out.width, h * scale);

  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, h * scale, out.width, footerH);
  ctx.fillStyle = "#475569";
  ctx.font = Math.round(11 * scale) + "px Arial, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(figureMetaText(opts), Math.round(10 * scale), h * scale + footerH / 2);

  var filename = _safeName(title || canvasId) + ".png";
  if (out.toBlob) {
    out.toBlob(function(blob) { _downloadBlob(blob, filename); }, "image/png");
  } else {
    _downloadBlob({}, filename);
  }
  return true;
}

/* Serialise an SVG to standalone XML, inlining computed text styles (external
   CSS is not applied to a detached SVG) and an explicit pixel size. */
function _serializeSVG(svg) {
  var clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  if (typeof window !== "undefined" && window.getComputedStyle) {
    var origTexts = svg.querySelectorAll("text");
    var cloneTexts = clone.querySelectorAll("text");
    for (var i = 0; i < origTexts.length && i < cloneTexts.length; i++) {
      var cs = window.getComputedStyle(origTexts[i]);
      if (!cs) continue;
      if (cs.fontFamily) cloneTexts[i].setAttribute("font-family", cs.fontFamily);
      if (cs.fontSize) cloneTexts[i].setAttribute("font-size", cs.fontSize);
      if (cs.fill) cloneTexts[i].setAttribute("fill", cs.fill);
    }
  }

  var vb = svg.getAttribute("viewBox");
  if (vb && !clone.getAttribute("width")) {
    var p = vb.split(/\s+/).map(Number);
    if (p.length === 4 && p[2] && p[3]) {
      clone.setAttribute("width", p[2]);
      clone.setAttribute("height", p[3]);
    }
  }
  return new XMLSerializer().serializeToString(clone);
}

function _findSVG(containerId) {
  var el = document.getElementById(containerId);
  if (!el) return null;
  if (el.tagName && el.tagName.toLowerCase() === "svg") return el;
  return el.querySelector ? el.querySelector("svg") : null;
}

function exportSVG(containerId, title, opts) {
  var svg = _findSVG(containerId);
  if (!svg) return false;
  var xml = _serializeSVG(svg);
  _downloadBlob(
    new Blob([xml], { type: "image/svg+xml;charset=utf-8" }),
    _safeName(title || containerId) + ".svg"
  );
  return true;
}

function exportSVGPNG(containerId, title, opts) {
  opts = opts || {};
  var svg = _findSVG(containerId);
  if (!svg || typeof Image === "undefined") return false;

  var xml = _serializeSVG(svg);
  var vb = svg.getAttribute("viewBox");
  var px = vb ? vb.split(/\s+/).map(Number) : null;
  var imgW = parseInt(svg.getAttribute("width"), 10) || (px && px[2]) || 800;
  var imgH = parseInt(svg.getAttribute("height"), 10) || (px && px[3]) || 600;

  var filename = _safeName(title || containerId) + ".png";
  var img = new Image();
  img.onload = function() {
    var scale = opts.scale || 2;
    var footerH = Math.round(26 * scale);
    var canvas = document.createElement("canvas");
    canvas.width = imgW * scale;
    canvas.height = imgH * scale + footerH;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, imgW * scale, imgH * scale);
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, imgH * scale, canvas.width, footerH);
    ctx.fillStyle = "#475569";
    ctx.font = Math.round(11 * scale) + "px Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(figureMetaText(opts), Math.round(10 * scale), imgH * scale + footerH / 2);
    if (canvas.toBlob) {
      canvas.toBlob(function(blob) { _downloadBlob(blob, filename); }, "image/png");
    }
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  return true;
}

/* All exportable figures, by container/canvas id. */
var FIGURE_TARGETS = [
  { id: "chart-effectors", title: "effector-types", kind: "chart" },
  { id: "chart-ph-timeline", title: "pathogen-timeline", kind: "chart" },
  { id: "chart-strategy", title: "strategy-distribution", kind: "chart" },
  { id: "chart-hubs", title: "hub-proteins", kind: "chart" },
  { id: "ml-pca-chart", title: "ml-pca", kind: "chart" },
  { id: "ml-umap-chart", title: "ml-umap", kind: "chart" },
  { id: "ml-classifier-chart", title: "classifier-comparison", kind: "chart" },
  { id: "interactome-graph", title: "interactome-network", kind: "svg" },
  { id: "phylogeny-tree", title: "effector-phylogeny", kind: "svg" }
];

function _mkButton(label, fn) {
  var b = document.createElement("button");
  b.type = "button";
  b.className = "figure-export-btn";
  b.textContent = label;
  b.title = "Download " + label;
  b.addEventListener("click", fn);
  return b;
}

function initFigureExport() {
  FIGURE_TARGETS.forEach(function(t) {
    var el = document.getElementById(t.id);
    if (!el) return;
    var host = (el.closest && el.closest(".chart-container")) || el.parentNode;
    if (!host) return;
    if (host.querySelector && host.querySelector(".figure-export-toolbar")) return;

    var bar = document.createElement("div");
    bar.className = "figure-export-toolbar";
    if (t.kind === "chart") {
      bar.appendChild(_mkButton("PNG", function() { exportChartPNG(t.id, t.title); }));
    } else {
      bar.appendChild(_mkButton("SVG", function() { exportSVG(t.id, t.title); }));
      bar.appendChild(_mkButton("PNG", function() { exportSVGPNG(t.id, t.title); }));
    }
    host.appendChild(bar);
  });
}

// Hook into init (preserve any previously installed wrapper).
var _origInitToolkit_fig = (typeof initToolkit === "function") ? initToolkit : null;
initToolkit = function() {
  if (_origInitToolkit_fig) _origInitToolkit_fig();
  initFigureExport();
};

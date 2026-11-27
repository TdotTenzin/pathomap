/*
  module-view.js - Shared rendering for analysis module cards.

  Used by the Discovery workspace and by each standalone module page so a
  module looks and behaves the same wherever it is opened.
*/

import { FIELD_LABELS } from '../discovery/ingest.js';
import { modulePageFor } from '../discovery/module-pages.js';
import { filterNetwork } from '../analysis/network.js';
import { createNetworkView } from '../views/interaction-network.js';
import { escapeXml as escapeHtml } from '../utils/export.js';

export const EXAMPLE = `pathogen,effector,sequence,host_protein,uniprot,pathway,phenotype,assay,value,evidence_class,doi,mechanism,gram_stain
Salmonella Typhimurium,SteE,MKTAILVFVKRLREGYDCPHQNA,ACTB,P60709,Actin cytoskeleton,intracellular,infection_score,0.82,experimental,10.1126/science.1234567,Actin remodeling,negative
Salmonella Typhimurium,GtgE,MKKLLLIVFFVAAALLLLGG,TUBB,P07437,Microtubule,intracellular,infection_score,0.91,experimental,10.1126/science.1234568,Vesicle trafficking,negative
Escherichia coli,EspF,MKDEEQQQQNNSSTTGGGCC,ACTB,P60709,Actin cytoskeleton,extracellular,infection_score,0.31,predicted,,Adhesion modulation,negative
Pseudomonas aeruginosa,ExoS,MKLLLFFFVVVAAAKKRRR,TUBB,P07437,Microtubule,intracellular,infection_score,0.78,annotation-derived,,Host cytoskeleton turnover,negative
Legionella pneumophila,SidC,MKRRKKLIVFFVVAAAGG,ACTB,P60709,Actin cytoskeleton,intracellular,infection_score,0.64,experimental,10.1126/science.1234569,Vacuole remodeling,negative
Legionella pneumophila,LepB,MKEEQQNNSSGGCCYYPP,RAB1,P20381,Vesicle trafficking,extracellular,infection_score,0.24,hypothetical,,Vesicle diversion,negative
Yersinia enterocolitica,YopE,MKDDQQNNSSGGCCYYPP,RAB1,P20381,Vesicle trafficking,extracellular,infection_score,0.39,predicted,,GTPase mimicry,negative
Yersinia enterocolitica,YopH,MKLLIIVVFFAARRKQQ,TUBB,P07437,Microtubule,intracellular,infection_score,0.71,experimental,10.1126/science.1234570,Phosphatase signaling,negative`;

export const TEMPLATE = EXAMPLE.split('\n').slice(0, 2).join('\n');

export function setStatus(element, message, tone = '') {
  if (!element) return;
  element.hidden = false;
  element.textContent = message;
  element.className = `exp-status${tone ? ` exp-status--${tone}` : ''}`;
}

export function renderMetrics(metrics) {
  if (!metrics || metrics.length === 0) return '';
  return `<div class="exp-metrics">${metrics.map((metric) => `
    <div class="exp-metric">
      <span class="exp-metric-value">${escapeHtml(metric.value)}</span>
      <span class="exp-metric-label">${escapeHtml(metric.label)}</span>
    </div>
  `).join('')}</div>`;
}

export function renderTable(table, maxRows = 100) {
  const visible = (table.rows || []).slice(0, maxRows);
  const header = (table.columns || []).map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join('');
  const body = visible.map((row) => `
    <tr>${(table.columns || []).map((column) => `<td>${escapeHtml(row[column.key] ?? '—')}</td>`).join('')}</tr>
  `).join('');
  const truncated = (table.rows || []).length > visible.length
    ? `<p class="exp-table-note">Showing first ${visible.length} of ${table.rows.length} rows.</p>`
    : '';

  return `
    <section class="disc-table-section">
      <h4>${escapeHtml(table.title || 'Results')}</h4>
      <div class="exp-table-wrap">
        <table class="exp-table">
          <thead><tr>${header}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${truncated}
    </section>
  `;
}

function renderFindings(findings = []) {
  if (findings.length === 0) return '';
  return `<ul class="disc-findings">${findings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join('')}</ul>`;
}

function renderModuleContent(view) {
  const tables = (view.tables || []).map((table) => renderTable(table)).join('');
  return `${renderMetrics(view.metrics)}${renderFindings(view.findings)}${tables}`;
}

function renderResultViews(result) {
  if (!result.views?.length) return renderModuleContent(result);

  const tabs = result.views.map((view, index) => `
    <button type="button" class="tool-btn tool-btn-sm mod-view-tab${index === 0 ? ' is-active' : ''}"
      data-view-tab="${escapeHtml(view.id)}" aria-pressed="${index === 0}">
      ${escapeHtml(view.label)}
    </button>
  `).join('');
  const panels = result.views.map((view, index) => `
    <div class="mod-view-panel" data-view-panel="${escapeHtml(view.id)}"${index === 0 ? '' : ' hidden'}>
      ${renderModuleContent(view)}
    </div>
  `).join('');

  return `
    <div class="mod-view-switch" data-view-switch="${escapeHtml(result.id)}">
      <div class="mod-view-tabs" role="group" aria-label="${escapeHtml(result.viewLabel || 'Result views')}">
        ${tabs}
      </div>
      ${panels}
    </div>
  `;
}

export function mountModuleViews(root) {
  if (!root) return;
  root.querySelectorAll('[data-view-switch]').forEach((switcher) => {
    const tabs = [...switcher.querySelectorAll('[data-view-tab]')];
    const panels = [...switcher.querySelectorAll('[data-view-panel]')];

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((item) => {
          const active = item === tab;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-pressed', String(active));
        });
        panels.forEach((panel) => {
          panel.hidden = panel.dataset.viewPanel !== tab.dataset.viewTab;
        });
      });
    });
  });
}

function statusLabel(result) {
  if (result.status === 'complete') return 'Results ready';
  if (result.status === 'failed') return 'Failed';
  if (result.status === 'waiting') return 'Waiting for data';
  return 'Insufficient data';
}

export function renderWaitingModule(module, {
  message = 'No dataset loaded yet. Use the controls above to add data.',
} = {}) {
  return `
    <details class="disc-module" id="module-${module.id}" data-module="${module.id}">
      <summary class="disc-module-summary">
        <span class="disc-number">${escapeHtml(module.number)}</span>
        <span class="disc-module-title">
          <strong>${escapeHtml(module.name)}</strong>
          <span>${escapeHtml(module.question)}</span>
        </span>
        <span class="disc-status disc-status--insufficient-data">Waiting for data</span>
      </summary>
      <div class="disc-module-body">
        <p class="disc-waiting">${escapeHtml(message)}</p>
      </div>
    </details>
  `;
}

export function renderModuleSummary(result) {
  const isComplete = result.status === 'complete';
  const headline = isComplete
    ? (result.findings[0] || result.notes[0] || 'Results are ready on the module page.')
    : (result.reasons[0] || 'No dataset loaded yet.');
  const metrics = isComplete ? result.metrics.slice(0, 3) : [];
  const metricHtml = metrics.length
    ? `<div class="disc-summary-metrics">${metrics.map((metric) => `
        <span class="disc-summary-metric"><strong>${escapeHtml(metric.value)}</strong> ${escapeHtml(metric.label)}</span>
      `).join('')}</div>`
    : '';

  return `
    <article class="disc-summary" id="summary-${result.id}" data-module="${result.id}">
      <div class="disc-summary-head">
        <span class="disc-number">${escapeHtml(result.number)}</span>
        <div>
          <h4>${escapeHtml(result.name)}</h4>
          <p>${escapeHtml(result.question)}</p>
        </div>
        <span class="disc-status disc-status--${result.status.replace(/\s+/g, '-')}">${statusLabel(result)}</span>
      </div>
      <p class="disc-summary-line">${escapeHtml(headline)}</p>
      ${metricHtml}
      <a class="disc-summary-link" href="${escapeHtml(modulePageFor(result.id))}" aria-label="Show full results for ${escapeHtml(result.name)}">
        Show full results <span aria-hidden="true">&rarr;</span>
      </a>
    </article>
  `;
}

export function renderWaitingSummary(module) {
  return renderModuleSummary({
    id: module.id,
    number: module.number,
    name: module.name,
    question: module.question,
    status: 'waiting',
    reasons: ['No dataset loaded yet. Use the controls above to add data.'],
    metrics: [],
    findings: [],
    notes: [],
    warnings: [],
  });
}

export function renderModule(result, { open = false } = {}) {
  const isComplete = result.status === 'complete';
  const reasons = !isComplete
    ? `<ul class="disc-reasons">${(result.reasons.length ? result.reasons : ['No results available.']).map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>`
    : '';

  const content = isComplete ? renderResultViews(result) : '';
  const notes = isComplete && result.notes.length
    ? `<ul class="exp-notes">${result.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
    : '';
  const warnings = result.warnings.length
    ? `<ul class="exp-warnings">${result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
    : '';
  const network = isComplete && result.network
    ? `<div class="disc-network" data-network-for="${result.id}"></div>`
    : '';

  return `
    <details class="disc-module" id="module-${result.id}" data-module="${result.id}" ${open ? 'open' : ''}>
      <summary class="disc-module-summary">
        <span class="disc-number">${escapeHtml(result.number)}</span>
        <span class="disc-module-title">
          <strong>${escapeHtml(result.name)}</strong>
          <span>${escapeHtml(result.question)}</span>
        </span>
        <span class="disc-status disc-status--${result.status.replace(/\s+/g, '-')}">${statusLabel(result)}</span>
      </summary>
      <div class="disc-module-body">
        ${reasons}
        ${content}
        ${network}
        ${notes}
        ${warnings}
      </div>
    </details>
  `;
}

export function networkMarkup() {
  return `
    <div class="ia-network-panel disc-network-panel">
      <div class="ia-network-toolbar">
        <p class="ia-network-status" data-network-status></p>
        <label class="exp-control disc-network-search">
          <span>Filter network</span>
          <input type="search" class="tool-input" data-network-search placeholder="Node, pathogen, evidence">
        </label>
        <div class="ia-network-controls" data-network-controls aria-label="Network view controls">
          <button type="button" class="tool-btn tool-btn-sm" data-network-action="zoom-out" aria-label="Zoom out">&minus;</button>
          <button type="button" class="tool-btn tool-btn-sm" data-network-action="fit">Fit</button>
          <button type="button" class="tool-btn tool-btn-sm" data-network-action="settle">Settle</button>
          <button type="button" class="tool-btn tool-btn-sm" data-network-action="reset">Reset</button>
          <button type="button" class="tool-btn tool-btn-sm" data-network-action="zoom-in" aria-label="Zoom in">+</button>
        </div>
      </div>
      <div class="ia-network-layout">
        <div class="ia-network-main">
          <div class="ia-network-canvas" data-network-canvas role="region" tabindex="0" aria-label="Interactive interaction network"></div>
          <div class="ia-network-empty" data-network-empty hidden><p>No interactions to display.</p></div>
        </div>
        <aside class="ia-details" data-network-details aria-label="Selected network item"></aside>
      </div>
    </div>
  `;
}

export function mountNetworks(root, { modules = [], dataset = null } = {}) {
  if (!root) return;
  root.querySelectorAll('[data-network-for]').forEach((container) => {
    const result = modules.find((module) => module.id === container.dataset.networkFor);
    if (!result?.network) return;
    container.innerHTML = networkMarkup();
    const view = createNetworkView({
      canvas: container.querySelector('[data-network-canvas]'),
      details: container.querySelector('[data-network-details]'),
      empty: container.querySelector('[data-network-empty]'),
      status: container.querySelector('[data-network-status]'),
      controls: container.querySelector('[data-network-controls]'),
    });
    view.render(dataset, result.network.model, result.network.filtered);

    const search = container.querySelector('[data-network-search]');
    if (search) {
      search.addEventListener('input', () => {
        const filtered = filterNetwork(result.network.model, { search: search.value });
        view.render(dataset, result.network.model, filtered);
      });
    }
  });
}

export function renderMappingGrid(container, headers, mapping, { actionLabel = 'Discover insights' } = {}) {
  if (!container) return;
  container.hidden = false;
  container.innerHTML = `
    <p class="disc-mapping-note">Columns were matched automatically. Change any selection, then click <strong>${escapeHtml(actionLabel)}</strong> again.</p>
    <div class="disc-mapping-grid">
      ${Object.entries(FIELD_LABELS).map(([field, label]) => `
        <label class="exp-control">
          <span>${escapeHtml(label)}</span>
          <select class="tool-input" data-mapping-field="${field}">
            <option value="">Not provided</option>
            ${headers.map((header) => `<option value="${escapeHtml(header)}" ${mapping[field] === header ? 'selected' : ''}>${escapeHtml(header)}</option>`).join('')}
          </select>
        </label>
      `).join('')}
    </div>
  `;
}

export function readMappingOverrides(container) {
  if (!container || container.hidden) return {};
  const overrides = {};
  container.querySelectorAll('[data-mapping-field]').forEach((select) => {
    overrides[select.dataset.mappingField] = select.value || null;
  });
  return overrides;
}

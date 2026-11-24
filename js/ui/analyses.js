/*
  analyses.js - Renders the Generated Analyses section.

  Purpose:
    Builds one card per entry in the analysis registry and shows whether the
    current dataset satisfies each module's prerequisites.

  Exports:
    renderAnalyses(dataset)  Render every module card. Pass `null` when no
                              dataset is loaded so cards show unmet requirements.
*/

import { getAnalysisModules } from '../analysis/registry.js';
import { isAnalysisEligible } from '../analysis/eligibility.js';
import { buildInteractionAnalysisSummary } from '../analysis/summary.js';
import { loadMatchingInteractionAnalysis } from '../data/interaction-analysis.js';

let summaryRenderId = 0;

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderSummaryPlaceholder(message) {
    return `
        <section class="analysis-summary analysis-summary--pending" data-analysis-summary aria-label="Dataset summary">
            <div class="analysis-summary-heading">Dataset summary</div>
            <p class="analysis-summary-message">${escapeHtml(message)}</p>
        </section>
    `;
}

function renderInteractionSummary(summary) {
    if (summary.status !== 'ready') {
        return `
            <section class="analysis-summary analysis-summary--unavailable" data-analysis-summary aria-label="Dataset summary">
                <div class="analysis-summary-heading">Dataset summary</div>
                <p class="analysis-summary-message">${escapeHtml(summary.reason)}</p>
            </section>
        `;
    }

    const metrics = summary.metrics.map((metric) => `
        <div class="analysis-metric">
            <span class="analysis-metric-value">${escapeHtml(metric.value)}</span>
            <span class="analysis-metric-label">${escapeHtml(metric.label)}</span>
        </div>
    `).join('');

    const findings = summary.findings.map((finding) => `
        <li class="analysis-finding">
            <strong>${escapeHtml(finding.label)}</strong>
            <span>${escapeHtml(finding.text)}</span>
            ${finding.note ? `<span class="analysis-finding-note">${escapeHtml(finding.note)}</span>` : ''}
        </li>
    `).join('');

    const evidence = summary.evidence;
    const coverageCounts = evidence.coveredCount !== null && evidence.interactionCount !== null
        ? ` (${evidence.coveredCount}/${evidence.interactionCount} relationships)`
        : '';
    const evidenceClasses = evidence.classes.map((row) => `
        <span class="analysis-evidence-chip analysis-evidence-chip--${escapeHtml(row.tone)}">
            ${escapeHtml(row.label)} <strong>${escapeHtml(row.count)}</strong>
        </span>
    `).join('');
    const validationLabel = evidence.validationPassed === null
        ? 'Validation result not reported.'
        : evidence.validationPassed
            ? 'Internal validation passed.'
            : 'Internal validation reported issues.';
    const unresolvedLabel = evidence.unresolvedTargetCount === null
        ? ''
        : `<span>${escapeHtml(evidence.unresolvedTargetCount)} unresolved host targets.</span>`;

    return `
        <section class="analysis-summary" data-analysis-summary aria-label="Dataset summary">
            <div class="analysis-summary-heading">Dataset summary</div>

            <div class="analysis-metrics">${metrics}</div>

            <div class="analysis-findings-heading">Key findings</div>
            <ul class="analysis-findings">${findings}</ul>

            <div class="analysis-evidence">
                <span class="analysis-evidence-label">Evidence</span>
                ${evidenceClasses}
                <span>Coverage ${escapeHtml(evidence.coverageLabel)}${escapeHtml(coverageCounts)}.</span>
                <span>${escapeHtml(evidence.note)}</span>
                ${unresolvedLabel}
                <span>${escapeHtml(validationLabel)}</span>
            </div>
        </section>
    `;
}

async function updateInteractionSummary(dataset, renderId) {
    const target = document.querySelector(
        '[data-module="interaction-analysis"] [data-analysis-summary]'
    );

    if (!target) {
        return;
    }

    let summary;

    try {
        const { analysis, errors } = await loadMatchingInteractionAnalysis(dataset);
        summary = buildInteractionAnalysisSummary(analysis, dataset);
        if (errors.length) {
            console.warn('Interaction analysis artifact unavailable:', errors);
        }
    } catch (error) {
        summary = buildInteractionAnalysisSummary(null, dataset);
        console.warn('Interaction analysis summary unavailable:', error);
    }

    // A newer dataset render may have replaced this card while the artifact was loading.
    if (renderId !== summaryRenderId || !document.contains(target)) {
        return;
    }

    target.outerHTML = renderInteractionSummary(summary);
}

export function renderAnalyses(dataset = null) {
    const container = document.getElementById('analysis-modules');
    const currentRenderId = ++summaryRenderId;

    if (!container) {
        console.warn('Analysis modules container not found.');
        return;
    }

    const modules = getAnalysisModules();
    if (modules.length === 0) {
        container.innerHTML = '<p class="muted">No analyses are available yet.</p>';
        return;
    }

    container.innerHTML = modules.map(module => {
        const eligibility = isAnalysisEligible(module, dataset);

        const eligibilityLabel = eligibility.eligible
            ? 'Data available'
            : 'Data requirements unmet';

        // Reasons are only listed when a module is not yet eligible.
        const requirements = eligibility.reasons.length
            ? `
                <ul class="analysis-requirements">
                    ${eligibility.reasons.map(reason => `<li>${reason}</li>`).join('')}
                </ul>
              `
            : '';

        const summary = module.id === 'interaction-analysis'
            ? renderSummaryPlaceholder(
                eligibility.eligible
                    ? 'Loading dataset summary…'
                    : 'Dataset summary unavailable until the required interaction data is loaded.'
            )
            : '';

        return `
            <article class="analysis-card" data-module="${module.id}">
                <div class="analysis-card-header">
                    <span class="analysis-number">${module.number}</span>
                    <span class="analysis-status">${module.status}</span>
                </div>

                <div class="analysis-card-content">
                    <h3>${module.name}</h3>
                    <p>${module.description}</p>

                    ${summary}
                    ${requirements}

                    <span class="analysis-eligibility">
                        ${eligibilityLabel}
                    </span>

                    ${module.page && eligibility.eligible
                        ? `<a class="analysis-open" href="${module.page}">Open analysis</a>`
                        : ''}
                </div>
            </article>
        `;
    }).join('');

    const interactionModule = modules.find((module) => module.id === 'interaction-analysis');
    if (interactionModule && isAnalysisEligible(interactionModule, dataset).eligible) {
        updateInteractionSummary(dataset, currentRenderId);
    }
}

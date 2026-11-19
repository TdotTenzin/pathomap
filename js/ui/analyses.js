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

export function renderAnalyses(dataset = null) {
    const container = document.getElementById('analysis-modules');

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

        return `
            <article class="analysis-card" data-module="${module.id}">
                <div class="analysis-card-header">
                    <span class="analysis-number">${module.number}</span>
                    <span class="analysis-status">${module.status}</span>
                </div>

                <div class="analysis-card-content">
                    <h3>${module.name}</h3>
                    <p>${module.description}</p>

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
}

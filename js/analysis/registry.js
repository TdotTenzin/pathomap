
// Only implemented analyses are listed here; planned modules are not exposed in the UI.
export const ANALYSIS_MODULES = [
    {
        id: "interaction-analysis",
        number: "01",
        name: "Interaction Analysis",
        description: "Explore host\u2013pathogen interaction relationships.",
        version: "1.1.0",
        status: "available",
        page: "/pages/interaction-analysis.html",
        prerequisites: {
            tables: ["pathogens", "effectors", "host_proteins", "interactions", "interaction_evidence"],
            fields: []
        }
    }
];

export function getAnalysisModules() {
    return ANALYSIS_MODULES.filter((m) => m.status === "available" && m.page);
}

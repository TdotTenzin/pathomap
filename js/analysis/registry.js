
export const ANALYSIS_MODULES = [
    {
        id: "interaction-analysis",
        number: "01",
        name: "Interaction Analysis",
        description: "Explore host–pathogen interaction relationships.",
        version: "1.0.0",
        status: "available",
        page: "interaction-analysis.html",
        prerequisites: {
            tables: ["pathogens", "effectors", "host_proteins", "interactions", "interaction_evidence"],
            fields: []
        }
    },
    {
        id: "effector-sequence-analysis",
        number: "02",
        name: "Effector Sequence Analysis",
        description: "Examine pathogen effector sequences and features.",
        version: "1.0.0",
        status: "available",
        page: "effector-sequence-analysis.html",
        prerequisites: {
            tables: ["effectors"],
            fields: []
        }
    },
    {
        id: "pathway-analysis",
        number: "03",
        name: "Pathway Analysis",
        description: "Explore biological pathways and their relationships.",
        version: "1.0.0",
        status: "available",
        page: "pathway-analysis.html",
        prerequisites: {
            tables: ["pathogens", "host_proteins"],
            fields: []
        }
    },
    {
        id: "functional-enrichment",
        number: "04",
        name: "Functional Enrichment",
        description: "Identify enriched biological functions.",
        version: "1.0.0",
        status: "available",
        page: "functional-enrichment.html",
        prerequisites: {
            tables: ["host_proteins"],
            fields: []
        }
    },
    {
        id: "protein-network-analysis",
        number: "05",
        name: "Protein Network Analysis",
        description: "Explore host and pathogen protein networks.",
        version: "1.0.0",
        status: "available",
        page: "protein-network-analysis.html",
        prerequisites: {
            tables: ["pathogens", "effectors", "host_proteins", "interactions"],
            fields: []
        }
    },
    {
        id: "comparative-pathogen-analysis",
        number: "06",
        name: "Comparative Pathogen Analysis",
        description: "Compare biological features across pathogens.",
        version: "1.0.0",
        status: "available",
        page: "comparative-pathogen-analysis.html",
        prerequisites: {
            tables: ["pathogens", "effectors"],
            fields: []
        }
    },
    {
        id: "host-response-analysis",
        number: "07",
        name: "Host Response Analysis",
        description: "Explore host response patterns and mechanisms.",
        version: "0.1.0",
        status: "planned",
        prerequisites: {
            tables: ["host_proteins"],
            fields: []
        }
    },
    {
        id: "predictive-modelling",
        number: "08",
        name: "Predictive Modelling",
        description: "Explore predictive approaches using available evidence.",
        version: "0.1.0",
        status: "planned",
        prerequisites: {
            tables: ["pathogens", "effectors", "host_proteins"],
            fields: []
        }
    }
];

export function getAnalysisModules() {
    return [...ANALYSIS_MODULES];
}

export function getAnalysisModule(id) {
    return ANALYSIS_MODULES.find(module => module.id === id) ?? null;
}

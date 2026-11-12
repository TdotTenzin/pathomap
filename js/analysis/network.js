/*
  network.js - Pure network model helpers for the Interaction Analysis page.

  Responsibilities:
    - Choose the Phase 4 derived network when it matches the loaded dataset.
    - Otherwise build a display-only graph from dataset interactions.
    - Add display-only pathogen -> effector membership links.
    - Apply filters and prune orphan nodes.
    - Build node/edge detail records for the UI.

  The module never touches the DOM and never changes the generated analysis.
*/

export const UNCLASSIFIED = 'Unclassified';

export const NODE_TYPE_ORDER = ['pathogen', 'effector', 'host_protein'];

export const NODE_TYPE_LABELS = {
    pathogen: 'Pathogen',
    effector: 'Effector',
    host_protein: 'Host protein',
};

export const EVIDENCE_CLASS_LABELS = {
    experimental: 'Experimental',
    predicted: 'Predicted',
    'annotation-derived': 'Annotation-derived',
    hypothetical: 'Hypothetical',
};

const EVIDENCE_RANK = {
    experimental: 4,
    predicted: 3,
    'annotation-derived': 2,
    hypothetical: 1,
};

const STRATEGY_LABELS = {
    arrest: 'Arrest',
    escape: 'Escape',
    reroute: 'Reroute',
    modified_compartment: 'Modified compartment',
    extracellular: 'Extracellular',
    unknown: 'Unknown',
};

export function classifyPathogen(row = {}) {
    if (row.gram_stain === 'Gram-positive' || row.gram_stain === 'Gram-negative') {
        return row.gram_stain;
    }

    const text = [row.name, row.phylum, row.class_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    if (/(viricota|viridae|virus)/.test(text)) return 'Virus';
    if (/(ascomycota|basidiomycota|mucoromycota|chytridiomycota|microsporid|fungus|fungi)/.test(text)) {
        return 'Fungus';
    }
    if (/(apicomplexa|nematoda|platyhelminthes|kinetoplastida|amoebozoa|parasite|plasmodium|toxoplasma|trypanosoma|leishmania|giardia|entamoeba)/.test(text)) {
        return 'Parasite';
    }

    return UNCLASSIFIED;
}

export function strongestEvidenceClass(classes = []) {
    let strongest = null;
    let rank = 0;

    classes.forEach((value) => {
        const current = EVIDENCE_RANK[value] || 0;
        if (current > rank) {
            strongest = value;
            rank = current;
        }
    });

    return strongest;
}

export function analysisMatchesDataset(analysis, dataset) {
    if (!analysis || !analysis.network || !Array.isArray(analysis.network.nodes)) {
        return false;
    }

    const meta = analysis.meta || {};
    const datasetMeta = dataset?.meta || {};
    const datasetInteractionCount = Array.isArray(dataset?.interactions)
        ? dataset.interactions.length
        : 0;
    const analysisInteractionCount = Number(analysis.statistics?.interaction_count);

    return (
        meta.analysis === 'interaction_analysis' &&
        meta.source_dataset_built_at === datasetMeta.built_at &&
        String(meta.source_dataset_schema_version || '') ===
            String(datasetMeta.schema_version || '') &&
        Number.isFinite(analysisInteractionCount) &&
        analysisInteractionCount === datasetInteractionCount
    );
}

function datasetIndexes(dataset) {
    const pathogensById = new Map();
    const pathogensByNumericId = new Map();
    const effectorsById = new Map();
    const hostProteinsById = new Map();
    const hostTargetsById = new Map();

    (dataset?.pathogens || []).forEach((row) => {
        if (row?.entity_id) pathogensById.set(row.entity_id, row);
        if (row?.pathogen_id !== null && row?.pathogen_id !== undefined) {
            pathogensByNumericId.set(Number(row.pathogen_id), row);
        }
    });
    (dataset?.effectors || []).forEach((row) => {
        if (row?.entity_id) effectorsById.set(row.entity_id, row);
    });
    (dataset?.host_proteins || []).forEach((row) => {
        if (row?.entity_id) hostProteinsById.set(row.entity_id, row);
    });
    (dataset?.host_targets || []).forEach((row) => {
        if (row?.host_target_id !== null && row?.host_target_id !== undefined) {
            hostTargetsById.set(Number(row.host_target_id), row);
        }
    });

    return { pathogensById, pathogensByNumericId, effectorsById, hostProteinsById, hostTargetsById };
}

function membershipId(pathogenId, effectorId) {
    return `MEMBERSHIP:${pathogenId}:${effectorId}`;
}

function membershipLink(effectorNode) {
    if (!effectorNode?.pathogen_id) return null;
    return {
        id: membershipId(effectorNode.pathogen_id, effectorNode.id),
        source: effectorNode.pathogen_id,
        target: effectorNode.id,
        type: 'pathogen_produces_effector',
        kind: 'membership',
    };
}

function labelsForNode(node, indexes) {
    if (node.type === 'effector' && !node.label) {
        node.label = indexes.effectorsById.get(node.id)?.effector_name || node.id;
    }
    if (node.type === 'host_protein' && !node.label) {
        node.label = indexes.hostProteinsById.get(node.id)?.protein_name || node.id;
    }
    if (node.type === 'pathogen' && !node.label) {
        node.label = indexes.pathogensById.get(node.id)?.name || node.id;
    }
    return node;
}

function nodeSortKey(node) {
    return [
        NODE_TYPE_ORDER.indexOf(node.type),
        String(node.label || node.id).toLowerCase(),
    ];
}

function sortNodes(nodes) {
    return nodes.sort((a, b) => {
        const left = nodeSortKey(a);
        const right = nodeSortKey(b);
        return left[0] - right[0] || left[1].localeCompare(right[1]);
    });
}

function sortEvidence(records = []) {
    return [...records].sort((a, b) => {
        const classRank = (EVIDENCE_RANK[b.evidence_class] || 0) - (EVIDENCE_RANK[a.evidence_class] || 0);
        if (classRank) return classRank;
        return String(a.evidence_id || '').localeCompare(String(b.evidence_id || ''));
    });
}

function fromAnalysis(analysis, dataset) {
    const indexes = datasetIndexes(dataset);
    const nodes = [];
    const nodeById = new Map();

    (analysis.network.nodes || []).forEach((source) => {
        if (!NODE_TYPE_ORDER.includes(source.type)) return;
        if (!source.id || nodeById.has(source.id)) return;

        const node = labelsForNode({ ...source }, indexes);
        if (node.type === 'pathogen') {
            const row = indexes.pathogensById.get(node.id);
            node.classification = row ? classifyPathogen(row) : UNCLASSIFIED;
        }
        nodes.push(node);
        nodeById.set(node.id, node);
    });

    const interactionEdges = (analysis.network.edges || [])
        .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
        .map((edge) => {
            const classes = [...(edge.evidence_classes || [])].sort();
            const sourceNode = nodeById.get(edge.source);
            return {
                ...edge,
                kind: 'interaction',
                pathogen_id: edge.pathogen_id || sourceNode?.pathogen_id || null,
                evidence_classes: classes,
                strongest_evidence_class:
                    edge.strongest_evidence_class || strongestEvidenceClass(classes),
                evidence_records: sortEvidence(edge.evidence_records || []),
            };
        });

    const membershipEdges = nodes
        .filter((node) => node.type === 'effector' && node.pathogen_id && nodeById.has(node.pathogen_id))
        .map(membershipLink)
        .filter(Boolean);

    return {
        nodes: sortNodes(nodes),
        interactionEdges: interactionEdges.sort((a, b) => String(a.id).localeCompare(String(b.id))),
        membershipEdges,
        source: {
            kind: 'derived',
            analysisVersion: analysis.meta?.analysis_version || null,
            generatedAt: analysis.meta?.generated_at || null,
            datasetBuiltAt: analysis.meta?.source_dataset_built_at || null,
            datasetSha256: analysis.meta?.source_dataset_sha256 || null,
            statistics: analysis.statistics || null,
            validation: analysis.validation || null,
            unresolvedTargets: analysis.unresolved_targets || null,
        },
    };
}

function fromDataset(dataset) {
    const indexes = datasetIndexes(dataset);
    const nodes = [];
    const nodeById = new Map();
    const interactionEdges = [];
    const seenPairs = new Set();

    const addNode = (node) => {
        if (!node?.id || !NODE_TYPE_ORDER.includes(node.type)) return null;
        if (!nodeById.has(node.id)) {
            nodeById.set(node.id, labelsForNode(node, indexes));
            nodes.push(nodeById.get(node.id));
        }
        return nodeById.get(node.id);
    };

    const evidenceByInteraction = new Map();
    (dataset?.interaction_evidence || []).forEach((record) => {
        if (!record?.interaction_id) return;
        const list = evidenceByInteraction.get(record.interaction_id) || [];
        list.push(record);
        evidenceByInteraction.set(record.interaction_id, list);
    });

    const interactions = [...(dataset?.interactions || [])].sort((a, b) =>
        String(a.interaction_id || '').localeCompare(String(b.interaction_id || ''))
    );

    interactions.forEach((row) => {
        const effector = indexes.effectorsById.get(row.effector_id);
        const hostProtein = indexes.hostProteinsById.get(row.host_protein_id);
        if (!effector || !hostProtein) return;

        const pathRow =
            indexes.pathogensByNumericId.get(Number(effector.pathogen_id)) ||
            (dataset.pathogens || []).find(
                (candidate) => candidate.name === effector.pathogen_name
            );

        const pairKey = `${row.effector_id}|${row.host_protein_id}`;
        if (seenPairs.has(pairKey)) return;
        seenPairs.add(pairKey);

        if (pathRow?.entity_id) {
            addNode({
                id: pathRow.entity_id,
                type: 'pathogen',
                label: pathRow.name,
                tax_id: pathRow.tax_id,
                classification: classifyPathogen(pathRow),
            });
        }

        addNode({
            id: effector.entity_id,
            type: 'effector',
            label: effector.effector_name,
            pathogen_id: pathRow?.entity_id || null,
            host_target_id: effector.host_target_id,
        });
        addNode({
            id: hostProtein.entity_id,
            type: 'host_protein',
            label: hostProtein.protein_name,
            gene_name: hostProtein.gene_name,
            uniprot_id: hostProtein.uniprot_id,
        });

        const evidence = sortEvidence(evidenceByInteraction.get(row.interaction_id) || []);
        const classes = [...new Set(evidence.map((item) => item.evidence_class).filter(Boolean))].sort();

        interactionEdges.push({
            id: row.interaction_id,
            source: row.effector_id,
            target: row.host_protein_id,
            type: row.interaction_type || 'effector_targets_host_protein',
            kind: 'interaction',
            mechanism: row.mechanism,
            pathogen_id: pathRow?.entity_id || null,
            pathogen_name: pathRow?.name || effector.pathogen_name || null,
            provenance: row.provenance,
            evidence_count: evidence.length,
            evidence_classes: classes,
            strongest_evidence_class: strongestEvidenceClass(classes),
            evidence_records: evidence,
        });
    });

    const membershipEdges = nodes
        .filter((node) => node.type === 'effector' && node.pathogen_id && nodeById.has(node.pathogen_id))
        .map(membershipLink)
        .filter(Boolean);

    return {
        nodes: sortNodes(nodes),
        interactionEdges: interactionEdges.sort((a, b) => String(a.id).localeCompare(String(b.id))),
        membershipEdges,
        source: {
            kind: 'dataset',
            analysisVersion: null,
            generatedAt: null,
            datasetBuiltAt: dataset?.meta?.built_at || null,
            datasetSha256: null,
            statistics: null,
            validation: null,
            unresolvedTargets: null,
        },
    };
}

export function buildNetworkModel(dataset, analysis = null) {
    const model = analysisMatchesDataset(analysis, dataset)
        ? fromAnalysis(analysis, dataset)
        : fromDataset(dataset || {});

    return {
        ...model,
        interactionCount: model.interactionEdges.length,
    };
}

export function getFilterOptions(model) {
    const pathogens = model.nodes
        .filter((node) => node.type === 'pathogen')
        .map((node) => ({ value: node.id, label: node.label, classification: node.classification }))
        .sort((a, b) => a.label.localeCompare(b.label));

    const hostProteins = model.nodes
        .filter((node) => node.type === 'host_protein')
        .map((node) => ({
            value: node.id,
            label: node.gene_name ? `${node.gene_name} - ${node.label}` : node.label,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

    const evidenceClasses = [...new Set(
        model.interactionEdges.flatMap((edge) => edge.evidence_classes || [])
    )].sort();

    const interactionTypes = [...new Set(
        model.interactionEdges.map((edge) => edge.type).filter(Boolean)
    )].sort();

    const classifications = [...new Set(
        pathogens.map((item) => item.classification).filter(Boolean)
    )].sort();

    return { pathogens, hostProteins, evidenceClasses, interactionTypes, classifications };
}

function searchTextForEdge(edge, sourceNode, targetNode, pathogenNode) {
    return [
        edge.id,
        edge.type,
        edge.mechanism,
        edge.provenance,
        edge.pathogen_name,
        ...(edge.evidence_classes || []),
        ...(edge.evidence_records || []).flatMap((record) => [
            record.evidence_id,
            record.doi,
            record.pmid,
            record.database_accession,
            record.provenance,
            record.note,
        ]),
        sourceNode?.label,
        sourceNode?.id,
        targetNode?.label,
        targetNode?.gene_name,
        targetNode?.uniprot_id,
        targetNode?.id,
        pathogenNode?.label,
        pathogenNode?.id,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

export function filterNetwork(model, filters = {}) {
    const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
    const query = String(filters.search || '').trim().toLowerCase();

    const interactionEdges = model.interactionEdges.filter((edge) => {
        const sourceNode = nodeById.get(edge.source);
        const targetNode = nodeById.get(edge.target);
        const pathogenNode = nodeById.get(edge.pathogen_id);

        if (filters.pathogenId && edge.pathogen_id !== filters.pathogenId) return false;
        if (filters.hostProteinId && edge.target !== filters.hostProteinId) return false;
        if (filters.interactionType && edge.type !== filters.interactionType) return false;
        if (
            filters.evidenceClass &&
            !(edge.evidence_classes || []).includes(filters.evidenceClass)
        ) {
            return false;
        }
        if (
            filters.classification &&
            (pathogenNode?.classification || UNCLASSIFIED) !== filters.classification
        ) {
            return false;
        }
        if (query && !searchTextForEdge(edge, sourceNode, targetNode, pathogenNode).includes(query)) {
            return false;
        }

        return true;
    });

    const usedEffectors = new Set(interactionEdges.map((edge) => edge.source));
    const usedHosts = new Set(interactionEdges.map((edge) => edge.target));
    const usedPathogens = new Set(
        interactionEdges.map((edge) => edge.pathogen_id).filter(Boolean)
    );

    const membershipEdges = model.membershipEdges.filter(
        (edge) => usedEffectors.has(edge.target) && usedPathogens.has(edge.source)
    );

    const usedNodeIds = new Set([
        ...usedEffectors,
        ...usedHosts,
        ...usedPathogens,
        ...membershipEdges.flatMap((edge) => [edge.source, edge.target]),
    ]);

    const nodes = model.nodes.filter((node) => usedNodeIds.has(node.id));

    return {
        ...model,
        nodes,
        interactionEdges,
        membershipEdges,
        interactionCount: interactionEdges.length,
        counts: {
            interactions: interactionEdges.length,
            effectors: usedEffectors.size,
            hostProteins: usedHosts.size,
            pathogens: usedPathogens.size,
            nodes: nodes.length,
        },
    };
}

function uniqueEvidence(edges) {
    const byId = new Map();
    edges.forEach((edge) => {
        (edge.evidence_records || []).forEach((record) => {
            const key =
                record.evidence_id ||
                `${edge.id}|${record.evidence_class}|${record.doi}|${record.pmid}|${record.database_accession}`;
            if (!byId.has(key)) byId.set(key, record);
        });
    });
    return sortEvidence([...byId.values()]);
}

function field(label, value, href = null) {
    if (value === null || value === undefined || value === '') return null;
    if (Array.isArray(value)) {
        value = value.filter(Boolean).join('; ');
        if (!value) return null;
    }
    return { label, value, href };
}

function compactFields(items) {
    return items.filter(Boolean);
}

function linkedRelated(model, nodeId, dataset) {
    const indexes = datasetIndexes(dataset);
    const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
    const ids = new Set();

    model.interactionEdges.forEach((edge) => {
        if (edge.source === nodeId) {
            ids.add(edge.target);
            if (edge.pathogen_id) ids.add(edge.pathogen_id);
        }
        if (edge.target === nodeId) {
            ids.add(edge.source);
            if (edge.pathogen_id) ids.add(edge.pathogen_id);
        }
        if (edge.pathogen_id === nodeId) {
            ids.add(edge.source);
            ids.add(edge.target);
        }
    });

    model.membershipEdges.forEach((edge) => {
        if (edge.source === nodeId) ids.add(edge.target);
        if (edge.target === nodeId) ids.add(edge.source);
    });

    ids.delete(nodeId);

    return [...ids]
        .map((id) => {
            const node = nodeById.get(id);
            if (!node) return null;
            return {
                id,
                type: node.type,
                label: node.label,
                detail:
                    node.type === 'host_protein'
                        ? indexes.hostProteinsById.get(id)?.gene_name || null
                        : null,
            };
        })
        .filter(Boolean)
        .sort((a, b) => NODE_TYPE_ORDER.indexOf(a.type) - NODE_TYPE_ORDER.indexOf(b.type) || a.label.localeCompare(b.label));
}

function domainItems(row) {
    return (row?.domains || [])
        .map((domain) => {
            if (typeof domain === 'string') return domain;
            return [domain?.name, domain?.accession].filter(Boolean).join(' ');
        })
        .filter(Boolean);
}

function goItems(row) {
    return (row?.go_terms || [])
        .map((term) => {
            if (typeof term === 'string') return term;
            return [term?.id, term?.term].filter(Boolean).join(' ');
        })
        .filter(Boolean);
}

function pathwayItems(row) {
    return (row?.pathways_detailed || []).map((pathway) => {
        if (typeof pathway === 'string') return pathway;
        return (
            pathway?.name ||
            pathway?.title ||
            pathway?.id ||
            JSON.stringify(pathway)
        );
    }).filter(Boolean);
}

function evidenceSummary(records) {
    return records.map((record) => ({
        evidence_id: record.evidence_id || null,
        evidence_class: record.evidence_class || 'hypothetical',
        doi: record.doi || null,
        pmid: record.pmid || null,
        database_accession: record.database_accession || null,
        provenance: record.provenance || null,
        note: record.note || null,
    }));
}

export function buildNodeDetail(dataset, model, nodeId) {
    const node = model.nodes.find((item) => item.id === nodeId);
    if (!node) return null;

    const indexes = datasetIndexes(dataset);
    const incidentEdges = model.interactionEdges.filter(
        (edge) => edge.source === nodeId || edge.target === nodeId || edge.pathogen_id === nodeId
    );
    const related = linkedRelated(model, nodeId, dataset);
    const evidence = evidenceSummary(uniqueEvidence(incidentEdges));
    const base = {
        kind: 'node',
        id: node.id,
        type: node.type,
        typeLabel: NODE_TYPE_LABELS[node.type] || node.type,
        title: node.label || node.id,
        subtitle: null,
        fields: [],
        paragraphs: [],
        lists: [],
        related,
        evidence,
        externalLinks: [],
    };

    if (node.type === 'pathogen') {
        const row = indexes.pathogensById.get(node.id) || {};
        base.subtitle = row.ncbi_scientific_name || null;
        base.fields = compactFields([
            field('NCBI Tax ID', row.tax_id),
            field('Gram stain', row.gram_stain),
            field('Acid-fast', row.acid_fast ? 'Yes' : 'No'),
            field('Strategy', STRATEGY_LABELS[row.strategy] || row.strategy),
            field('Intracellular niche', row.intracellular_niche),
            field('Strain / serovar', row.serovar || row.strain),
            field('Genome size (Mb)', row.genome_size_mb),
            field('GC content (%)', row.gc_content),
            field('Assembly', row.assembly_level),
            field('Genome accession', row.genome_accession),
            field('Linked interactions', incidentEdges.length),
        ]);
        if (row.description) base.paragraphs.push({ label: 'Description', text: row.description });
        if (row.curation_notes) base.paragraphs.push({ label: 'Curation notes', text: row.curation_notes });
        if (row.reference_ids?.length) {
            base.lists.push({ label: 'References', items: row.reference_ids.map((id) => ({ text: id })) });
        }
        if (row.reference_doi) {
            base.externalLinks.push({ label: `DOI ${row.reference_doi}`, href: `https://doi.org/${row.reference_doi}` });
        }
    }

    if (node.type === 'effector') {
        const row = indexes.effectorsById.get(node.id) || {};
        const pathogen = indexes.pathogensById.get(node.pathogen_id);
        const target = indexes.hostTargetsById.get(Number(row.host_target_id));
        base.subtitle = row.type || null;
        base.fields = compactFields([
            field('Pathogen', pathogen?.name || row.pathogen_name),
            field('Type', row.type),
            field('Mechanism', row.mechanism),
            field('Host target', row.host_target),
            field('Target resolution', target?.resolution_status),
            field('UniProt', row.uniprot_id),
            field('Sequence length (aa)', row.sequence_length),
            field('Molecular weight (Da)', row.molecular_weight_da),
            field('Isoelectric point', row.isoelectric_point),
            field('GRAVY', row.gravy_score),
            field('Feature status', row.feature_status),
            field('Linked interactions', incidentEdges.length),
        ]);
        if (target?.audit_notes) {
            base.paragraphs.push({ label: 'Target audit note', text: target.audit_notes });
        }
        const domains = domainItems(row);
        if (domains.length) base.lists.push({ label: 'Domains', items: domains.map((text) => ({ text })) });
        const goTerms = goItems(row);
        if (goTerms.length) base.lists.push({ label: 'GO terms', items: goTerms.map((text) => ({ text })) });
        if (row.uniprot_id) {
            base.externalLinks.push({
                label: `UniProt ${row.uniprot_id}`,
                href: `https://www.uniprot.org/uniprotkb/${encodeURIComponent(row.uniprot_id)}/entry`,
            });
        }
    }

    if (node.type === 'host_protein') {
        const row = indexes.hostProteinsById.get(node.id) || {};
        base.subtitle = row.gene_name || null;
        base.fields = compactFields([
            field('Gene', row.gene_name),
            field('UniProt', row.uniprot_id),
            field('Localization', row.localization),
            field('Pathway', row.pathway),
            field('Sequence length (aa)', row.sequence_length),
            field('Molecular weight (Da)', row.molecular_weight_da),
            field('Isoelectric point', row.isoelectric_point),
            field('GRAVY', row.gravy_score),
            field('Linked interactions', incidentEdges.length),
        ]);
        if (row.function) base.paragraphs.push({ label: 'Function', text: row.function });
        const domains = domainItems(row);
        if (domains.length) base.lists.push({ label: 'Domains', items: domains.map((text) => ({ text })) });
        const goTerms = goItems(row);
        if (goTerms.length) base.lists.push({ label: 'GO terms', items: goTerms.map((text) => ({ text })) });
        const pathways = pathwayItems(row);
        if (pathways.length) {
            base.lists.push({ label: 'Pathway memberships', items: pathways.map((text) => ({ text })) });
        }
        if (row.uniprot_id) {
            base.externalLinks.push({
                label: `UniProt ${row.uniprot_id}`,
                href: `https://www.uniprot.org/uniprotkb/${encodeURIComponent(row.uniprot_id)}/entry`,
            });
        }
    }

    return base;
}

export function buildEdgeDetail(dataset, model, edgeId) {
    const edge = model.interactionEdges.find((item) => item.id === edgeId);
    if (!edge) return null;

    const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const pathogenNode = nodeById.get(edge.pathogen_id);
    const indexes = datasetIndexes(dataset);
    const hostRow = indexes.hostProteinsById.get(edge.target) || {};

    return {
        kind: 'edge',
        id: edge.id,
        title: `${sourceNode?.label || edge.source} -> ${targetNode?.gene_name || targetNode?.label || edge.target}`,
        subtitle: pathogenNode?.label || edge.pathogen_name || null,
        fields: compactFields([
            field('Interaction ID', edge.id),
            field('Relationship', edge.type),
            field('Mechanism', edge.mechanism),
            field('Pathogen', pathogenNode?.label || edge.pathogen_name),
            field('Effector', sourceNode?.label),
            field('Host protein', targetNode?.label),
            field('Host gene', hostRow.gene_name),
            field('Host UniProt', hostRow.uniprot_id),
            field('Evidence classes', (edge.evidence_classes || []).map((value) => EVIDENCE_CLASS_LABELS[value] || value)),
            field('Evidence count', edge.evidence_count),
            field('Provenance', edge.provenance),
        ]),
        paragraphs: [],
        lists: [],
        related: [pathogenNode, sourceNode, targetNode]
            .filter(Boolean)
            .map((node) => ({ id: node.id, type: node.type, label: node.label })),
        evidence: evidenceSummary(edge.evidence_records || []),
        externalLinks: [],
    };
}

export function evidenceClassLabel(value) {
    return EVIDENCE_CLASS_LABELS[value] || value || 'No evidence';
}

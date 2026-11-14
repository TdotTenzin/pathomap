# Generated Analyses

Specification for the computed-analysis layer. Source: `PathoMap_Future_Development_Plan.docx`
(7 November 2026), sections 4-8. This document is the reference for module behaviour; delivery
order lives in `docs/ROADMAP.md`.

## Three-layer model

| Layer | Contents | Rule |
|---|---|---|
| Primary / curated | Pathogens, effectors, host proteins, references | Versioned, validated, stable IDs, provenance |
| Derived relationships | Effector-host candidates, computed associations | Regenerate from primary inputs; record method and evidence |
| Analytical outputs | Networks, enrichment, comparisons, sequence features, model outputs | Reproducible outputs/caches; never presented as curated facts |

The website is the presentation layer only. Scientific logic does not live in view code.

## Evidence classes

Every generated record must carry exactly one:

- `experimental` - direct experimental support in a cited source.
- `predicted` - produced by a computational method.
- `annotation-derived` - inferred from database annotations (GO, pathway, domain).
- `hypothetical` - proposed relationship with no supporting evidence yet.

Broad annotations (for example "mitochondria") are not evidence of binding to a specific protein.
Host-host interaction partners do not establish effector-host interactions. Shared pathway
membership does not prove direct interaction or pathway perturbation.

## Required provenance for generated records

- Stable generated-record ID plus IDs of all source records.
- Analysis module and software version.
- Input dataset version or content hash.
- Algorithm, parameters and reference-resource versions.
- Evidence class and confidence/score with an explicit definition.
- Source citation or database accession where available.
- Generation timestamp, validation status and warnings.

Do not call a heuristic score a probability. Do not report a result when the inputs are
insufficient - return `insufficient data` with the missing requirement instead.

## Module contract

```js
{
  id: "interaction-analysis",
  version: "0.1.0",
  prerequisites: ["pathogens", "effectors", "host_proteins"],
  canRun(dataset) -> { eligible, reasons },
  run(dataset, context) -> {
    reportProgress(stage, completed, total),
    results, metrics, warnings, provenance
  },
  validate(results) -> { valid, issues }
}
```

Engines return structured data, never HTML. Views render; utilities handle identifier
normalization, provenance, statistics and validation. Unit tests use small known-answer cases.

## Module states

| State | Meaning | UI behaviour |
|---|---|---|
| Not available | Not implemented or disabled | Label planned/unavailable; never imply it ran |
| Queued | Inputs valid; prerequisites/compute pending | Queued; no fabricated percentage |
| Running | Computation underway | Determinate progress only if measurable; otherwise indeterminate + stage |
| Complete | Computation and output validation succeeded | 100% only after validation; summary + open action |
| Insufficient data | Required fields, labels or sample size missing | State exactly what is missing |
| Skipped | Excluded or prerequisite failed | Show reason/dependency |
| Failed | Unexpected error | Safe summary, developer log, retry |

## Dependencies

| Module | Prerequisites |
|---|---|
| Interaction Analysis | Pathogens + effectors + host proteins with explicit target IDs and row evidence |
| Pathway Analysis | Host protein IDs and pathway annotations; interaction output if analysing associated targets |
| Protein Network Analysis | Defined edge source and IDs; host-host vs effector-host edges kept distinct |
| Functional Enrichment | Mapped protein set, annotation release, defensible background universe |
| Effector Sequence Analysis | Effector records with valid amino-acid sequences |
| Comparative Pathogen Analysis | Comparable pathogen features, effector annotations or target sets |
| Host Response Analysis | Evidence-linked targets and process annotations with direction/mechanism |
| Predictive Modelling | Sufficient labelled examples, feature matrix, defined target, leakage-aware validation |

## Dashboard cards

Each card shows its own state and progress. Summary metrics must be analysis-specific and
data-derived:

| Module | Summary metrics |
|---|---|
| Interactions | Candidate relationships; unique effectors; unique host proteins; evidence breakdown |
| Pathway Analysis | Proteins mapped; pathways represented; enriched pathways if tested |
| Protein Networks | Nodes; edges; components; high-centrality nodes |
| Functional Enrichment | Terms tested; significant terms; annotation coverage; adjusted p-value range |
| Effector Sequence Analysis | Sequences analysed; missing/invalid sequences; feature distributions |
| Comparative Pathogen Analysis | Pathogens compared; shared/unique effectors; similarity/cluster summary |
| Host Response Analysis | Processes represented; evidence-linked proteins; mechanism categories |
| Predictive Modelling | Model status; validation design; sample count; supported metrics |

## Detail page template

1. Title, purpose, status, dataset/run provenance.
2. Executive summary: what was analysed, principal results, caveats.
3. Key metrics with definitions and denominators.
4. Interactive visualisation appropriate to the analysis.
5. Searchable/filterable results table.
6. Biological interpretation separated from observations and predictions.
7. Methods: algorithm, formulas, parameters, reference data, software version.
8. Evidence and provenance with citations/accessions.
9. Limitations, unmapped records, missingness, quality warnings.
10. CSV/figure export carrying provenance metadata.

---

## 1. Interaction Analysis

**Question:** Which pathogen effectors have candidate relationships with which host proteins, and
how strong is the evidence?

**Inputs:** validated pathogens, effectors, host proteins; explicit target identifiers; row-level
evidence and citations.

**Methods:** identifier/alias resolution; stable-ID joins; protein-level target matching;
evidence classification and scoring; bipartite graph construction; relationship deduplication.

**Outputs:** candidate relationships; unique effectors and host proteins; evidence breakdown;
unresolved targets; source and rationale per edge.

**Guardrail:** broad target annotations and host-host network data cannot be promoted to confirmed
effector-host interactions.

**Python implementation:** `scripts/analyze_interactions.py` (analysis version 1.1) writes
`data/derived/interaction_analysis.json` without modifying curated tables.

- **Eligibility:** requires `pathogens`, `effectors`, `host_proteins`, `host_targets`,
  `interactions` and `interaction_evidence` tables.
- **Validation:** checks stable-ID type/format, referential integrity (effector → pathogen,
  interaction → effector/host protein), duplicate IDs, broken relationships, duplicate
  effector-to-host pairs, evidence class, provenance, orphan evidence and semantic duplicate
  evidence. Discarded rows are recorded with `code`, `detail` and `row_id`.
- **Deduplication:** one edge per `(effector_id, host_protein_id)`, retaining the
  lexicographically earliest `interaction_id`; conflicting duplicate details are reported.
  Evidence identity is `interaction_id|evidence_class|doi|pmid|database_accession|provenance`.
- **Outputs:** provenance metadata (dataset schema/build time/SHA-256, analysis parameters),
  validation summary, unique effector/host-protein/host-target/pathogen statistics,
  interaction and evidence statistics, host proteins targeted by multiple pathogens,
  unresolved targets grouped by `resolution_status`, and sorted network nodes/edges. Edges
  carry relationship predicate, mechanism, provenance, evidence classes and citations.
- **CLI:** `--check` validates without writing, `--dataset`/`--output` override paths, and
  `--strict` exits non-zero when validation or result issues exist. Result self-validation
  checks edge/node integrity and count reconciliation before export.
- **Tests:** `python -m unittest discover -s tests -v` covers known-answer, validation,
  deduplication, unresolved-target, network and CLI cases.

**Browser implementation (Phase 5):** `interaction-analysis.html` renders the network model from
`data/derived/interaction_analysis.json` when its dataset build timestamp, schema version and
interaction count match the loaded dataset. Sample or uploaded datasets fall back to a
display-only graph built from `interactions` and `interaction_evidence`; the page labels this
difference honestly.

- **View:** layered pathogen → effector → host-protein SVG layout with display-only
  pathogen-encodes-effector membership links. Effector-host edges use the strongest evidence
  class for line style and colour (experimental solid, predicted dashed, annotation-derived
  dotted, hypothetical dash-dot).
- **Filters:** text search, pathogen, host protein, evidence class, interaction type, and
  pathogen classification. Orphan effectors, pathogens and host proteins are pruned after
  filtering.
- **Details:** clicking a node or edge opens biological fields joined by stable ID, related
  entities, evidence records, citations and external UniProt/DOI links.
- **Exports:** filtered network JSON with provenance and active filters, node/edge CSV, and SVG
  with embedded metadata. Downloads reflect the current filters.
- **Tests:** `node --test tests/network_model.test.mjs` covers derived/fallback selection,
  membership links, combined filters, detail joins and CSV escaping.

## 2. Effector Sequence Analysis

**Question:** What molecular and sequence-derived properties characterise the effector set?

**Inputs:** effector records with valid amino-acid sequences.

**Methods:** alphabet/length/ambiguous-residue validation; amino-acid composition; molecular
weight; theoretical pI; GRAVY; sliding-window hydrophobicity, charge or composition summaries;
optional motif/domain annotations with attribution.

**Outputs:** per-sequence feature table; distributions by pathogen/strategy; missing-sequence
report; exportable feature matrix.

**Guardrail:** sequence-derived properties are not direct evidence of localization, secretion,
structure or function.

Feature backlog and current implementation status: `docs/SEQUENCE_FEATURES.md`.

## 3. Pathway Analysis

**Question:** Which annotated host pathways are represented among host proteins associated with
pathogen effectors?

**Inputs:** host protein IDs and pathway annotations; interaction output when analysing
effector-associated targets.

**Methods:** stable-accession pathway mapping; membership summaries; graph traversal; enrichment
only with a defensible background.

**Outputs:** mapped proteins; pathways represented; contributing proteins; enrichment statistics
where valid; unmapped records.

**Guardrail:** pathway association is not proof of perturbation; enrichment requires a defensible
background and multiple-testing correction.

## 4. Functional Enrichment

**Question:** Does a host-protein set contain more annotations from a category than expected?

**Inputs:** input protein set, background universe, GO/other annotation release.

**Methods:** identifier mapping; hypergeometric or Fisher's exact test; Benjamini-Hochberg FDR.

**Outputs:** significant terms; raw and adjusted p-values; effect size; gene ratios; contributing
proteins; annotation coverage; background definition.

**Guardrail:** small sets and incomplete annotations produce unstable results; never report
significance without background and correction.

## 5. Protein Network Analysis

**Question:** What structure do host-protein and supported effector-host relationships form?

**Inputs:** defined edge source and stable IDs; edge types.

**Methods:** graph construction; degree, betweenness and closeness centrality; connected
components; community detection where size supports it; evidence-aware node/edge inspection.

**Outputs:** nodes, edges, components, hubs, clusters, node attributes and interactive views.

**Guardrail:** centrality describes graph structure, not biological importance; results depend on
coverage and edge provenance.

## 6. Comparative Pathogen Analysis

**Question:** How do pathogens differ by effector repertoire, annotations, targets and strategy?

**Inputs:** comparable per-pathogen feature sets.

**Methods:** descriptive statistics; Jaccard similarity; distance/similarity matrices;
hierarchical clustering; optional dimensionality reduction.

**Outputs:** pairwise similarity matrix; clusters; shared/unique effectors; shared target
annotations; comparative summaries.

**Guardrail:** account for unequal annotation coverage, dataset size and missingness; similarity
does not establish shared evolutionary origin.

## 7. Host Response Analysis

**Question:** Which host processes are associated with effector targets, and in which direction?

**Inputs:** evidence-linked targets and process annotations; direction/mechanism where available.

**Methods:** annotation aggregation; process-level statistics; optional network propagation with
documented assumptions; stratified summaries.

**Outputs:** affected-process summaries; evidence-linked proteins; mechanism distributions;
cross-pathogen process comparisons.

**Guardrail:** do not imply a measured cellular response when the source only describes an
effector mechanism or inferred target.

## 8. Predictive Modelling

**Question:** Can sequence or annotation features predict a defined label, for example
intracellular survival strategy?

**Inputs:** defined target and unit of analysis; feature matrix; labeled examples.

**Methods:** baseline model first; logistic regression and random forest as initial candidates;
pathogen-aware splits such as leave-one-pathogen-out; calibration and feature importance.

**Outputs:** predicted labels/scores; confusion matrix; precision, recall, F1, suitable ROC-AUC;
split details; feature importance; limitations.

**Guardrail:** do not claim meaningful prediction with too few independent labelled examples;
prevent leakage; never present predictions as facts. If data are inadequate, publish a readiness
assessment instead of weak metrics.

---

## Documentation checklist for every module

1. Scientific question and intended interpretation.
2. Required input tables, fields and identifiers.
3. Eligibility checks and minimum data requirements.
4. Algorithm description and mathematical definitions.
5. Parameters and defaults.
6. External reference databases and versions.
7. Output schema and metric definitions.
8. Evidence classification and provenance rules.
9. Validation strategy and known-answer test cases.
10. Known limitations and conditions that return `insufficient data`.

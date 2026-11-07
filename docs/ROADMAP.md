# Roadmap

Derived from the current repo state and `PathoMap_Future_Development_Plan.docx` (7 November 2026).
Module specifications live in `docs/ANALYSES.md`; architecture lives in `docs/ARCHITECTURE.md`;
sequence-feature detail lives in `docs/SEQUENCE_FEATURES.md`.

## Priorities

| Priority | Meaning |
|---|---|
| **P0** | Blocks correctness or the first usable release |
| **P1** | Required for the first analysis release |
| **P2** | Valuable follow-up; can ship later |

## Status

| Status | Meaning |
|---|---|
| **Done** | Merged and verified in the current build |
| **In progress** | Partially implemented |
| **Planned** | Not started |

## Baseline

- `main` branch; static vanilla-JS app with a Python build pipeline.
- Dataset schema **2.0**: `pathogens` (53), `effectors` (246), `host_proteins` (20).
- No references table, no analysis layer, no Generated Analyses UI.

## Done

- [x] Confirm active branch, dataset and current UI. **P0**
- [x] Document the three-table baseline in `DATASET.md` and `ARCHITECTURE.md`. **P0**
- [x] Reconcile stale pathogens-only wording in `index.html`. **P0**
- [x] Normalize pathogens with NCBI taxonomy and genome metadata. **P0**
- [x] Enrich effectors with UniProt/InterPro/Pfam and computed sequence features. **P0**
- [x] Enrich host proteins with UniProt, GO, pathway and STRING data. **P0**

## In progress — Phase 1: primary data foundation

- [ ] Add stable `effector_id`; stop keying effectors by `(effector_name, pathogen_name)`. **P0**
- [ ] Link effectors to pathogens by `pathogen_id` instead of display name. **P0**
- [ ] Add referential-integrity checks and a reproducible sample dataset. **P0**
- [ ] Normalize references into their own table and add per-row references. **P1**
- [ ] Remove non-protein compartment entries from host proteins; resolve remaining targets. **P1**
- [ ] Second pathogens pass: lifestyle, replication niche, host range, transmission, disease, BSL. **P2**
- [ ] Move computed sequence features out of curated effector rows into a derived table. **P1**

See `docs/DATASET.md` for relationships and `docs/SEQUENCE_FEATURES.md` for feature status.

**Milestone:** validated, versioned primary dataset with stable IDs.

## Planned

### Phase 2 — Website information architecture

- [ ] Add Generated Analyses below Database. **P1**
- [ ] Add Research & Methods navigation once the page exists. **P2**
- [ ] Build the dashboard shell with eight cards and honest unavailable/placeholder states. **P1**
- [ ] Build one reusable detail-page template. **P1**
- [ ] Add routing and dataset/run identity display. **P1**

Details: `docs/ARCHITECTURE.md`.

### Phase 3 — Orchestration framework

- [ ] `js/analysis/registry.js` and the shared module contract. **P1**
- [ ] `orchestrator.js`: prerequisites, scheduling, cancellation, run lifecycle. **P1**
- [ ] `analysis-state.js`: status, progress, timestamps, warnings, errors. **P1**
- [ ] Dataset version/content hash and stale-result invalidation on new load. **P1**
- [ ] Measurable progress units and indeterminate fallback. **P1**
- [ ] Cache keys including input version, module version, parameters and reference versions. **P1**
- [ ] Web Workers for CPU-heavy modules. **P2**

Contract: `docs/ANALYSES.md`.

### Phase 4 — First functional modules

- [ ] Interaction Analysis (module 1). **P1**
- [ ] Effector Sequence Analysis (module 2). **P1**
- [ ] Pages, evidence display, filters, exports and known-answer tests for both. **P1**

### Phase 5 — Core biological interpretation

- [ ] Pathway Analysis (module 3). **P1**
- [ ] Functional Enrichment (module 4). **P1**
- [ ] Protein Network Analysis (module 5). **P2**

### Phase 6 — Comparative and host response

- [ ] Comparative Pathogen Analysis (module 6), coverage-aware. **P2**
- [ ] Host Response Analysis (module 7) with evidence directionality. **P2**

### Phase 7 — Predictive modelling

- [ ] Define the prediction target and unit of analysis. **P2**
- [ ] Assess label quality, sample size and class balance. **P2**
- [ ] Build baseline models with pathogen-aware validation. **P2**
- [ ] Report metrics only when defensible; otherwise publish a data-readiness assessment. **P2**

### Phase 8 — Quality and release

- [ ] Unit, schema, integration and end-to-end tests. **P1**
- [ ] Validate upload, progress, cancellation and dataset switching. **P1**
- [ ] Review provenance and scientific claims. **P1**
- [ ] Document methods and dependencies. **P1**
- [ ] Test accessibility, responsiveness, performance and exports. **P2**

## Module status

| # | Module | Phase | Priority | Status |
|---|---|---|---|---|
| 1 | Interaction Analysis | 4 | P1 | Planned |
| 2 | Effector Sequence Analysis | 4 | P1 | In progress — MW, pI, GRAVY, domains shipped; backlog in `docs/SEQUENCE_FEATURES.md` |
| 3 | Pathway Analysis | 5 | P1 | Planned |
| 4 | Functional Enrichment | 5 | P1 | Planned |
| 5 | Protein Network Analysis | 5 | P2 | Planned |
| 6 | Comparative Pathogen Analysis | 6 | P2 | Planned |
| 7 | Host Response Analysis | 6 | P2 | Planned |
| 8 | Predictive Modelling | 7 | P2 | Planned — research question in `index.html` |

## Acceptance criteria for the first analysis release

- A user can load a supported dataset and receives clear validation feedback.
- Database remains usable while analyses run.
- Generated Analyses appears only after a successful load.
- Every card has a truthful state; no invented progress.
- A completed module opens while another is still running.
- Each completed module has data-derived summary metrics.
- Each module has a detail page with results, methods, evidence and limitations.
- Switching datasets prevents stale results from appearing current.
- Experimental, predicted, annotation-derived and hypothetical results are visibly distinct.
- A reproducible sample dataset and tests verify the workflow.

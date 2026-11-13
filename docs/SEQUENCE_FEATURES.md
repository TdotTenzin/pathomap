# Effector Sequence Features

Feature specification for **Effector Sequence Analysis** (module 2 in `docs/ANALYSES.md`;
implementation phase in `docs/ROADMAP.md`). Statuses reflect the current build
(`scripts/build_effectors_host_proteins.py`, `js/data/schema.js`).

Status legend: **Implemented** = stored on the effector row; **Partial** = annotation present but
no prediction/probability; **Planned** = not implemented.

## Status summary

| Feature | Field | Status | Method |
|---|---|---|---|
| Sequence length | `sequence_length` | Implemented | Calculated |
| Molecular weight | `molecular_weight_da` | Implemented | Residue mass sum minus water |
| Isoelectric point | `isoelectric_point` | Implemented | Henderson–Hasselbalch + bisection |
| GRAVY | `gravy_score` | Implemented | Kyte–Doolittle mean |
| Domains | `domains` | Implemented | UniProt / InterPro / Pfam |
| GO terms | `go_terms` | Implemented | UniProt |
| Signal peptide | `signal_peptide` | Partial | UniProt annotation, no probability |
| Transmembrane regions | `transmembrane_regions` | Partial | UniProt annotation, no predictor |
| Eukaryotic-like domains | `domains` | Partial | Annotated, not classified |

**Phase 6 implementation:** `scripts/analyze_effector_sequences.py` computes the following into
`data/derived/effector_sequence_analysis.json` without modifying effector rows: amino-acid
composition, Cys/Pro/Gly fractions, aliphatic index, aromaticity, Shannon entropy, a labelled
low-complexity fraction, N-terminal composition, RxLR/PEXEL motif hits, and domain coverage plus
domain-family summaries. Dipeptide/tripeptide composition, polarity, repeats and hydrogen-bonding
counts remain unimplemented. External prediction tools remain out of scope for the current
standard-library pipeline.

## Directly computable with Python / Biopython

No external prediction service needed. These are the lowest-cost, highest-value additions.

### Amino acid composition
Frequency of each of the 20 residues (or a reduced alphabet of 6–10 groups to cut
dimensionality). Count per residue type, divide by length.

### Dipeptide composition
400 possible adjacent pairs, normalized by total pairs. Reduce with PCA or top-k selection.

### Tripeptide composition
8000 possible triplets; requires filtering or dimensionality reduction.

### Cysteine / proline / glycine content
Count and fraction of each residue. Cysteine hints at disulfide potential; proline and glycine
affect backbone flexibility.

### Aliphatic index
`AI = X(Ala) + 2.9·X(Val) + 3.9·(X(Ile) + X(Leu))` where `X` is mole percent.

### Aromaticity
Fraction of Phe, Tyr and Trp.

### Polarity
Mean Grantham or equivalent polarity score across the sequence.

### Shannon entropy
`H = -Σ p_i·log2(p_i)` over the amino-acid distribution. This replaces the separate
"sequence entropy / complexity" entry; ship one feature, not two.

### Low-complexity regions
SEG-style window scan for homopolymeric/repetitive stretches; report count and total length.

### Sequence repeats
Tandem/simple repeats via a sliding-window detector. Tandem Repeats Finder is optional; a
documented heuristic is acceptable if labelled as such.

### Host-targeting motifs
Regex scan over a maintained motif set (for example RxLR, PEXEL). Requires a curated motif list.

### Hydrogen bonding capacity
Count predicted donors/acceptors from residue properties.

### Domain-derived summaries
Coverage, domain families per pathogen, and per-module aggregation. Uses the already-annotated
`domains` field.

### N-terminal composition
Analyse the first 20–50 residues separately. Composition-only; secretion prediction still needs
an external tool.

## Requires external prediction tools

Each of these must record tool name, version and parameters in the output provenance.

| Feature | Suggested tool |
|---|---|
| Secondary structure propensity | PSIPRED, Chou–Fasman, NetSurfP |
| Coiled-coil propensity | COILS, MARCOIL, Paircoil2 |
| Transmembrane prediction | TMHMM, Phobius |
| Signal peptide probability | SignalP, Phobius, TATP (secretion-system specific) |
| Linear B-cell epitope propensity | BepiPred |
| Solvent accessibility | NetSurfP, ACCpro |
| Surface electrostatics | Requires 3D structure or a documented 2D approximation |
| Aggregation propensity | TANGO, AGGRESCAN |
| Evolutionary conservation | Multiple sequence alignment + ConSurf or equivalent |
| Subcellular localisation signals | DeepLoc, TargetP |
| Flexibility indices | Karplus–Schulz scale (computable, but validation benefits from a reference tool) |
| Chaperone-binding motifs | Scan against a maintained motif database |

## Recommended implementation order

### Priority 1 — low cost, high value
- Amino acid composition (20 features)
- Aliphatic index, aromaticity, polarity
- Cysteine, proline and glycine content
- Shannon entropy
- Low-complexity region count and length

Molecular weight, pI, GRAVY and domain presence already ship.

### Priority 2 — moderate cost
- Dipeptide composition with PCA or feature selection
- Secondary structure propensity
- Host-targeting motif scan
- Domain-derived summaries (coverage, families per pathogen)

### Priority 3 — external tools or higher cost
- Transmembrane and signal-peptide prediction beyond annotations
- Coiled-coil prediction
- Subcellular localisation signals
- Evolutionary conservation
- Surface accessibility, electrostatics and aggregation

## Output requirements

- One row per effector, keyed by the stable `entity_id`.
- Every feature records its method/version and whether it is calculated, annotation-derived or
  predicted.
- Report invalid or missing sequences explicitly; never silently impute.
- Export the feature matrix with provenance metadata for the module page and modelling.

## Implementation notes

- Prefer existing Python libraries: Biopython, protr, scikit-learn.
- Cache external predictions; include tool version and parameters in the cache key.
- Reduce dimensionality for dipeptide/tripeptide features.
- Feature selection (mutual information, ANOVA F-value) can identify informative features.
- Compute features consistently across all sequences and dataset loads.

## Scientific guardrail

Sequence-derived properties are not direct evidence of localisation, secretion, structure or
function. Label them as computed features and keep them separate from curated annotations.

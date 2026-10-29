# Sequence Feature Expansion Plans

## Additional Physicochemical and Structural Properties

This document outlines potential sequence features beyond hydrophobicity, intrinsic disorder, and charge that could be computed for effector protein analysis.

## Composition-Based Features

### Amino Acid Composition
- **Status**: Not implemented
- **Description**: Frequency of each of the 20 amino acids (or reduced alphabets grouping similar residues)
- **Implementation**: Count each amino acid type, divide by total length. Consider using reduced alphabets (e.g., 6-10 groups) to reduce dimensionality.

### Dipeptide Composition
- **Status**: Not implemented
- **Description**: Pairs of adjacent residues capturing local sequence patterns
- **Implementation**: Count all 400 possible dipeptides, normalize by total dipeptides. Use dimensionality reduction (PCA) or select top-k most informative dipeptides.

### Tripeptide Composition
- **Status**: Not implemented
- **Description**: Triplets of adjacent residues for more complex patterns
- **Implementation**: 8000 possible combinations; likely requires filtering or dimensionality reduction.

### Cysteine Content
- **Status**: Not implemented
- **Description**: Indicates potential for disulfide bonds, which affect stability
- **Implementation**: Count cysteine residues, optionally include disulfide bond prediction.

### Proline Content
- **Status**: Not implemented
- **Description**: Creates structural kinks, influences folding kinetics
- **Implementation**: Count proline residues, compute fraction of total.

### Glycine Content
- **Status**: Not implemented
- **Description**: Provides flexibility in backbone conformation
- **Implementation**: Count glycine residues, compute fraction of total.

## Global Physicochemical Properties

### Molecular Weight
- **Status**: Not implemented
- **Description**: Influences diffusion rates and secretion efficiency
- **Implementation**: Sum of amino acid molecular weights.

### Isoelectric Point (pI)
- **Status**: Not implemented
- **Description**: pH at which net charge is zero; affects subcellular localization
- **Implementation**: Use Biopython's `ProteinAnalysis.isoelectric_point()` or Henderson-Hasselbalch calculation.

### Aliphatic Index
- **Status**: Not implemented
- **Description**: Correlates with thermostability
- **Implementation**: Calculate using formula: AI = X(Ala) + a * X(Val) + b * X(Ile) + b * X(Leu), where a=2.9, b=3.9.

### GRAVY (Grand Average of Hydropathy)
- **Status**: Not implemented
- **Description**: Overall hydrophobicity averaged across the sequence
- **Implementation**: Use Kyte-Doolittle scale, average across all residues.

### Aromaticity
- **Status**: Not implemented
- **Description**: Proportion of aromatic residues (Phe, Tyr, Trp)
- **Implementation**: Count aromatic residues, divide by total length.

### Polarity
- **Status**: Not implemented
- **Description**: Overall polar vs non-polar character
- **Implementation**: Use Grantham or other polarity scales, average across sequence.

## Structural Propensity Features

### Secondary Structure Propensity
- **Status**: Not implemented
- **Description**: Predicted alpha-helix, beta-sheet, and coil fractions
- **Implementation**: Use PSIPRED, Chou-Fasman, or modern ML predictors (e.g., NetSurfP).

### Flexibility Indices
- **Status**: Not implemented
- **Description**: Local backbone flexibility (e.g., Karplus-Schulz parameters)
- **Implementation**: Use Karplus-Schulz flexibility scale, compute per-residue values and aggregate statistics.

### Coiled-Coil Propensity
- **Status**: Not implemented
- **Description**: Many effectors form coiled-coil oligomers
- **Implementation**: Use COILS, MARCOIL, or Paircoil2 to predict coiled-coil regions.

### Transmembrane Domain Likelihood
- **Status**: Not implemented
- **Description**: Presence of membrane-spanning regions
- **Implementation**: Use TMHMM, Phobius, or similar predictors.

### Signal Peptide Probability
- **Status**: Not implemented
- **Description**: Critical for secretion through bacterial systems (type III, IV, VI)
- **Implementation**: Use SignalP, Phobius, or TATP for secretion system-specific predictions.

## Motif and Pattern Features

### Low-Complexity Regions
- **Status**: Not implemented
- **Description**: Stretches of repetitive residues common in effectors
- **Implementation**: Use SEG algorithm or simple sliding window to detect homopolymeric/repetitive regions.

### Sequence Repeats
- **Status**: Not implemented
- **Description**: Tandem repeats or simple sequence repeats
- **Implementation**: Use Tandem Repeats Finder or TRF for detection.

### Host-Targeting Motifs
- **Status**: Not implemented
- **Description**: Known patterns like RxLR, PEXEL, or other pathogen-specific signals
- **Implementation**: Scan with regex patterns for known motifs; maintain motif database.

### Functional Domain Presence
- **Status**: Not implemented
- **Description**: Presence of specific catalytic or binding domains
- **Implementation**: Use InterProScan, Pfam, or HMMER to annotate domains.

### Linear B-Cell Epitope Propensity
- **Status**: Not implemented
- **Description**: Regions likely to be recognized by immune system
- **Implementation**: Use BepiPred or similar epitope prediction tools.

## Surface and Interaction Features

### Predicted Solvent Accessibility
- **Status**: Not implemented
- **Description**: Fraction of residues exposed vs buried
- **Implementation**: Use NetSurfP or ACCpro for accessibility prediction.

### Surface Electrostatic Potential Distribution
- **Status**: Not implemented
- **Description**: Spatial arrangement of charge patches
- **Implementation**: Requires 3D structure prediction (AlphaFold) or use simpler 2D approximations.

### Hydrogen Bonding Capacity
- **Status**: Not implemented
- **Description**: Number of potential donors/acceptors
- **Implementation**: Count donor/acceptor atoms based on amino acid properties.

### Aggregation Propensity
- **Status**: Not implemented
- **Description**: Tendency to form aggregates (relevant for virulence factors)
- **Implementation**: Use TANGO, AGGRESCAN, or similar aggregation predictors.

## Complexity and Evolutionary Features

### Sequence Entropy/Complexity
- **Status**: Not implemented
- **Description**: Measures sequence variability
- **Implementation**: Compute Shannon entropy based on amino acid distribution.

### Shannon Entropy of Amino Acid Distribution
- **Status**: Not implemented
- **Description**: Diversity of residue usage
- **Implementation**: H = -Σ p_i * log2(p_i) where p_i is frequency of amino acid i.

### Evolutionary Conservation Scores
- **Status**: Not implemented
- **Description**: Highly conserved regions often indicate functional importance
- **Implementation**: Requires multiple sequence alignments; use tools like ConSurf if alignments available.

## Effector-Specific Considerations

### N-Terminal Targeting Signals
- **Status**: Not implemented
- **Description**: Many effectors have secretion signals in first 20-50 residues
- **Implementation**: Analyze first 50 residues separately; use secretion system-specific predictors.

### Eukaryotic-Like Domains
- **Status**: Not implemented
- **Description**: Domains mimicking host proteins
- **Implementation**: Use domain databases to identify eukaryotic-like domains.

### Chaperone-Binding Motifs
- **Status**: Not implemented
- **Description**: Patterns indicating interaction with secretion chaperones
- **Implementation**: Scan for known chaperone-binding patterns; maintain motif database.

### Subcellular Localization Signals
- **Status**: Not implemented
- **Description**: Nuclear localization signals, mitochondrial targeting, etc.
- **Implementation**: Use DeepLoc, TargetP, or similar localization predictors.

## Recommended Initial Implementation

### Priority 1 (Low computational cost, high value)
- Amino acid composition (20 features)
- Molecular weight, pI, aliphatic index, GRAVY
- Signal peptide probability
- Low-complexity region count and length

### Priority 2 (Moderate computational cost)
- Dipeptide composition (with PCA or feature selection)
- Secondary structure propensity
- Cysteine, proline, glycine content
- Functional domain presence

### Priority 3 (Higher computational cost or complex integration)
- Transmembrane domain prediction
- Coiled-coil prediction
- Subcellular localization signals
- Evolutionary conservation (requires alignments)

## Implementation Notes

- Use existing Python libraries where possible: Biopython, protr, scikit-learn
- For complex predictions requiring external tools, consider caching results
- Dimensionality reduction may be needed for high-dimensional features (dipeptides, tripeptides)
- Feature selection (e.g., mutual information, ANOVA F-value) can identify most informative features
- Ensure features are computed consistently across all effector sequences

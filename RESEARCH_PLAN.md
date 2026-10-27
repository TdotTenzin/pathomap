# Research-Oriented Transformation Plan

**Goal**: Transform PathoMap from an educational resource to a research-focused analysis platform, following patterns from IDR_ES and similar research tools.

---

## Overview

### Current State
- Educational focus with explanations and tutorials
- Pre-computed views only (no real-time analysis)
- Static curated dataset
- Simple exports (CSV only)

### Target State
- Research focus with computational tools
- Real-time analysis capabilities
- External data integration
- Publication-ready outputs (figures, networks, data)

---

## Research Question & Hypothesis

### Core Research Question
**"Do effector protein sequence features predict intracellular survival strategies across diverse bacterial pathogens?"**

### Working Hypothesis
**"Specific sequence motifs (e.g., hydrophobicity patterns, disorder regions, charge distributions) correlate with evasion strategies (arrest vs escape vs reroute vs modified_compartment vs extracellular)."**

### Biological Rationale
- Intracellular pathogens have evolved distinct strategies to survive within host cells
- Effector proteins are the primary mediators of these strategies
- Sequence features may reflect functional adaptations to specific intracellular niches
- Understanding these relationships could enable prediction of pathogen behavior from sequence data alone

### Research Objectives
1. **Characterize** effector sequence features across 54 bacterial pathogens
2. **Identify** sequence motifs associated with each evasion strategy
3. **Build** predictive models linking sequence features to survival strategies
4. **Validate** predictions against known experimental data
5. **Provide** a computational framework for novel effector annotation

### Expected Impact
- Enable rapid prediction of pathogen behavior from genome sequences
- Identify conserved effector motifs as potential therapeutic targets
- Provide a comparative framework for studying host-pathogen co-evolution
- Bridge computational biology with experimental microbiology

---

## Academic Context & Background

### Student Profile
- **Current Status**: 5th year undergraduate
- **Academic Background**: Strong foundations in biology, chemistry, physics, mathematics, and computer science
- **Advanced Coursework**:
  - BIOD15: Single-cell & Cell-type related Omics
  - BIOD19: Foundations and Research Areas in Epigenetics
  - Harvard Reproducible Science certification
- **Research Experience**: Terebiznik Lab volunteer (microbiology/host-pathogen research)
- **Technical Skills**: Python, JavaScript, R, machine learning, network analysis, bioinformatics

### Why This Project Aligns with Graduate Studies
1. **Computational Biology Focus**: Bridges sequence analysis, network science, and machine learning
2. **Reproducible Research**: Emphasizes Harvard Reproducible Science principles
3. **Real-World Data**: Integrates with UniProt, PHI-base, IntAct databases
4. **Translational Potential**: Could inform therapeutic target identification
5. **Interdisciplinary Approach**: Combines wet-lab biology with computational methods

### Target Graduate Programs
- Computational Biology / Bioinformatics
- Microbiology & Immunology
- Systems Biology
- Genomics & Data Science

---

## Presentation Strategy for Applications

### Personal Statement Framing
**Key Narrative**: "Developed a computational platform to analyze host-pathogen interactions, combining sequence analysis, network science, and machine learning to identify features predictive of intracellular survival strategies."

**Key Points to Emphasize**:
- Integrated data from UniProt, PHI-base, and IntAct to create a reproducible analysis pipeline
- Addressed limitations of current tools by enabling comparative analysis across 54 pathogens
- Applied Harvard Reproducible Science principles to ensure research quality
- Built a full-stack application with offline-first architecture and real-time analysis capabilities

### Technical Interview Preparation
**Be Ready to Explain**:
- ML feature engineering process (why 11 features, why RandomForest)
- Biological rationale behind each feature
- Trade-offs in architecture (offline-first vs real-time analysis)
- How to extend the system (genome data, ecology layer)
- Statistical considerations (sample size limitations, cross-validation)

**Technical Deep-Dive Topics**:
- Thread-local connection pooling for SQLite
- Module-level caching for ML models and network graphs
- State machine modeling for phagosome maturation
- Hypergeometric enrichment testing with multiple comparison correction
- Phylogenetic tree construction (MSA + neighbor-joining)

### Lab Rotation / Meeting Strategy
**When Discussing with Professors**:
- Offer to analyze their data using the platform
- Show how the tool could answer their specific research questions
- Demonstrate export features (researchers love publication-ready figures)
- Discuss potential collaborations (data integration, method development)
- Be honest about limitations (classifier accuracy, data sparsity)

**Demo Talking Points**:
- "This tool lets you compare pathogen strategies across 54 organisms"
- "You can export networks directly to Cytoscape for further analysis"
- "The ML component helps identify which effector features matter most"
- "All methods are documented and reproducible, with DOI versioning"

---

## Quick Wins to Implement This Week

### Priority 1: Add Research Question to Homepage (1-2 hours)
**Implementation**:
- Add "Research Objectives" section to `index.html` before Database
- State the core question and hypothesis clearly
- Link to detailed methods documentation
- Add "Current Status" badge showing "v0.4.0 - Research Phase"

**Why**: Immediately shifts perception from educational to research-focused.

### Priority 2: Add External Database Links (2-3 hours)
**Implementation**:
- Add `uniprot_id` column to `host_proteins.csv`
- Add `phi_base_id` column to `effectors.csv`
- Add `intact_id` column to `effector_targets.csv`
- Update API to generate clickable URLs
- Render links in database tables

**Why**: Shows integration with real scientific databases.

### Priority 3: Add High-Res Export Buttons (3-4 hours)
**Implementation**:
- Create `js/figure-export.js` utility module
- Add export buttons to all Chart.js visualizations
- Add SVG export for D3 visualizations (network, phylogeny)
- Include metadata footer (dataset version, date, parameters)
- Support PNG (300+ DPI) and SVG formats

**Why**: Researchers need publication-quality figures.

### Priority 4: Add "How to Cite" Section (1 hour)
**Implementation**:
- Add citation section to homepage
- Include BibTeX format
- Add DOI placeholder (can register on Zenodo later)
- Include version information

**Why**: Shows understanding of academic conventions.

### Priority 5: Add Methods Section (1-2 hours)
**Implementation**:
- Add Methods section to `index.html`
- Document algorithms for each analysis module
- Include pseudocode where appropriate
- Link to detailed documentation in ONBOARDING.md

**Why**: Research tools prioritize methodology over explanations.

**Total Time**: ~10 hours for immediate impact

---

## What Makes This Stand Out

### Differentiation from Other Undergraduate Projects
Most undergraduate projects fall into one of two categories:
1. **Purely computational**: No biological grounding, just technical implementation
2. **Purely biological**: No computational skills, just literature review or basic lab work

**PathoMap bridges both** - this is rare and valuable.

### Key Strengths for Graduate Applications

1. **Full-Stack Development**
   - Frontend: JavaScript, D3, Chart.js
   - Backend: Python, FastAPI, SQLite
   - Data: NetworkX, scikit-learn, Biopython
   - Deployment: Docker, Vercel

2. **Biological Depth**
   - Domain knowledge of phagosome maturation
   - Understanding of bacterial evasion strategies
   - Integration with primary literature
   - Connection to real research questions

3. **Reproducible Research**
   - Harvard Reproducible Science training applied
   - Version-controlled dataset (v0.4.0)
   - Comprehensive testing (pytest + frontend tests)
   - Docker environment for reproducibility

4. **Real-World Integration**
   - External database links (UniProt, PHI-base, IntAct)
   - Publication-ready exports
   - Multiple analysis tools in one platform
   - Offline-first with optional live API

5. **Scientific Maturity**
   - Honest reporting of limitations (classifier accuracy, data sparsity)
   - Statistical rigor (cross-validation, multiple testing correction)
   - Clear research question and hypothesis
   - Connection to broader field

### What Professors Look For

**They want to see**:
1. You understand the biological problem ✓
2. You have computational skills to address it ✓
3. You can communicate to both audiences ✓
4. You understand reproducibility standards ✓
5. You can situate work in broader literature ✓

**Your profile aligns perfectly** with computational biology/bioinformatics programs.

---

## Priority Levels

### 🔥 Quick Wins (1-2 days)
Low-hanging fruit that immediately shift the tone from educational to research.

### 📈 Medium Effort (1-2 weeks)
Significant features requiring new endpoints and UI components.

### 🚀 Major Effort (1-2 months)
Substantial architectural changes requiring careful planning.

---

## Phase 1: Quick Wins

### 1.1 Add Methods Section

**Why**: Research tools prioritize methodology over explanations.

**Changes**:
- Add "Methods" section to `index.html` before "Database"
- Document algorithms used in each analysis module
- Add citation format for the dataset
- Version the dataset (already v0.4.0, make it prominent)

**Implementation**:
```html
<!-- Add to index.html -->
<section id="methods">
  <h2>Methods</h2>
  <div class="method-card">
    <h3>Trafficking Prediction</h3>
    <p>Marker-based stage matching using pre-computed stage profiles...</p>
    <details>
      <summary>Algorithm details</summary>
      <pre><!-- pseudocode --></pre>
    </details>
  </div>
  <!-- Repeat for each analysis type -->
</section>
```

**Files to modify**:
- `index.html` (add Methods section)
- `README.md` (add methods documentation)
- `ONBOARDING.md` (update architecture section)

**Success criteria**: Methods section visible on page, documents all analysis algorithms.

---

### 1.2 High-Res Figure Export

**Why**: Researchers need publication-quality figures.

**Changes**:
- Add export buttons to all charts (bar, radar, network, phylogeny)
- Support PNG and SVG formats
- Allow custom dimensions (width × height DPI)
- Add metadata (dataset version, date, parameters)

**Implementation**:
```javascript
// js/figure-export.js (new file)
exportFigure(canvas, format, width, height, metadata) {
  // Use Chart.js native export for Chart.js charts
  // Use SVG serialization for D3 visualizations
  // Add metadata footer
}
```

**Files to modify**:
- `js/charts.js` (add export buttons)
- `js/network.js` (add SVG export)
- `js/phylogeny.js` (add SVG export)
- `js/figure-export.js` (new utility module)

**Success criteria**: All visualizations have export buttons, outputs include metadata.

---

### 1.3 Network Export Formats

**Why**: Researchers need to import networks into Cytoscape/Gephi.

**Changes**:
- Add API endpoint `/api/interactome/export`
- Support GraphML, JSON (NetworkX format), and adjacency matrix
- Include node attributes (type, organism, features)
- Include edge attributes (interaction type, source)

**Implementation**:
```python
# api/index.py
@app.get("/api/interactome/export")
async def export_interactome(format: str = "graphml"):
    graph = get_interactome_graph()
    if format == "graphml":
        return Response(content=generate_graphml(graph), media_type="application/xml")
    elif format == "json":
        return nx.node_link_data(graph)
    # ... other formats
```

**Files to modify**:
- `api/index.py` (add export endpoint)
- `src/pathomap/interactome.py` (add export methods)
- `js/network.js` (add download button)

**Success criteria**: Network exports work in 3 formats, openable in Cytoscape.

---

### 1.4 Side-by-Side Pathogen Comparison

**Why**: Comparative analysis is core to research.

**Changes**:
- Add "Compare" section with multi-select dropdown
- Display effector overlap Venn diagram
- Show strategy differences table
- Heatmap of shared vs unique effectors

**Implementation**:
```javascript
// js/comparison.js (new file)
class PathogenComparison {
  selectedPathogens = new Set();

  addPathogen(name) { this.selectedPathogens.add(name); }
  removePathogen(name) { this.selectedPathogens.delete(name); }

  renderComparison() {
    // Venn diagram
    // Strategy table
    // Heatmap
  }
}
```

**Files to modify**:
- `index.html` (add Compare section)
- `js/comparison.js` (new module)
- `api/index.py` (add `/api/compare/pathogens` endpoint)

**Success criteria**: Can select 2+ pathogens, view comparison visualizations.

---

## Phase 2: Medium Effort

### 2.1 Custom Enrichment Analysis UI

**Why**: Researchers want to test their own protein lists.

**Changes**:
- New "Enrichment Tool" section
- Input: protein list (text area or file upload)
- Options: background set, correction method, p-value threshold
- Output: results table + volcano plot + export

**Implementation**:
```python
# api/index.py
@app.post("/api/analysis/custom-enrichment")
async def custom_enrichment(request: EnrichmentRequest):
    proteins = request.proteins
    background = request.background  # 'all', 'pathogen-specific', 'custom'
    correction = request.correction  # 'bonferroni', 'fdr'
    # ... run enrichment
    return results
```

```javascript
// js/enrichment-tool.js (new file)
class EnrichmentCalculator {
  proteinList = [];
  background = 'all';
  correction = 'bonferroni';

  async calculate() {
    const response = await fetch('/api/analysis/custom-enrichment', {
      method: 'POST',
      body: JSON.stringify({
        proteins: this.proteinList,
        background: this.background,
        correction: this.correction
      })
    });
    return response.json();
  }
}
```

**Files to modify**:
- `api/index.py` (add custom enrichment endpoint)
- `src/pathomap/enrichment.py` (add custom enrichment function)
- `index.html` (add Enrichment Tool section)
- `js/enrichment-tool.js` (new module)

**Success criteria**: User can input protein list, get enrichment results with plots.

---

### 2.2 ML Parameter Tuning

**Why**: Researchers need to explore model behavior.

**Changes**:
- Add UI for RandomForest hyperparameters
- Allow training on subset of pathogens
- Real-time cross-validation results
- Export trained model

**Implementation**:
```python
# api/index.py
@app.post("/api/ml/train-custom")
async def train_custom_model(request: TrainingRequest):
    params = request.params  # n_estimators, max_depth, etc.
    subset = request.subset  # list of pathogen names
    # ... train model
    return {
        model: serialize(model),
        cv_scores: cv_results,
        feature_importance: ...
    }
```

**Files to modify**:
- `api/index.py` (add custom training endpoint)
- `src/pathomap/ml/classifier.py` (add training with parameters)
- `js/ml-plots.js` (add parameter tuning UI)
- `index.html` (add ML parameter controls)

**Success criteria**: User can adjust parameters, see updated CV scores in real-time.

---

### 2.3 External Database Links

**Why**: Researchers need to connect to primary data sources.

**Changes**:
- Add UniProt links to host proteins
- Add PHI-base links to effectors
- Add IntAct links to interactions
- Add PubMed links to relevant papers

**Implementation**:
```python
# src/pathomap/data/seed/host_proteins.csv
# Add uniprot_id column

# api/index.py
def add_external_links(protein):
    if protein.uniprot_id:
        protein.uniprot_url = f"https://www.uniprot.org/uniprot/{protein.uniprot_id}"
    # ... other links
```

**Files to modify**:
- `src/pathomap/data/seed/host_proteins.csv` (add UniProt IDs)
- `src/pathomap/data/seed/effectors.csv` (add PHI-base IDs)
- `api/index.py` (add link generation)
- `js/database.js` (render links in tables)

**Success criteria**: All proteins/effectors have clickable external links.

---

### 2.4 Session State & Save/Load

**Why**: Researchers need to save analysis workflows.

**Changes**:
- Save current analysis state to JSON
- Load saved analysis from file
- Export analysis as reproducible script
- Share analysis via URL (state encoded)

**Implementation**:
```javascript
// js/session-manager.js (new file)
class SessionManager {
  saveState() {
    const state = {
      selectedPathogens: [...comparison.selectedPathogens],
      enrichmentQuery: enrichmentTool.proteinList,
      mlParams: mlTool.params,
      timestamp: new Date().toISOString()
    };
    downloadJSON(state, 'pathomap-analysis.json');
  }

  loadState(file) {
    // restore state from JSON
  }
}
```

**Files to modify**:
- `js/session-manager.js` (new module)
- `index.html` (add Save/Load buttons)
- `js/database.js` (integrate with session)

**Success criteria**: Can save full state, reload and restore UI exactly.

---

## Phase 3: Major Effort

### 3.1 Sequence-Based Analysis Tools

**Why**: Researchers need to analyze effector sequences directly.

**Changes**:
- Add BLAST-like sequence search
- Calculate molecular features from sequences (hydrophobicity, charge, disorder)
- Compare effectors by sequence similarity
- Add motif search interface

**Implementation**:
```python
# src/pathomap/sequence_analysis.py (new module)
class SequenceAnalyzer:
    def calculate_features(self, sequence):
        return {
            length: len(sequence),
            hydrophobicity: calculate_hydrophobicity(sequence),
            charge: calculate_charge(sequence),
            disorder: calculate_disorder(sequence),
            # ... 144 features like IDR_ES
        }

    def find_similar(self, query_seq, threshold=0.7):
        # pairwise alignment or k-mer search
        pass
```

**Files to modify**:
- `src/pathomap/sequence_analysis.py` (new module)
- `api/index.py` (add sequence analysis endpoints)
- `index.html` (add Sequence Analysis section)
- `js/sequence-analysis.js` (new module)

**Success criteria**: Can paste sequence, get feature profile and similar effectors.

---

### 3.2 Custom Network Comparison

**Why**: Researchers want to compare their own interactomes.

**Changes**:
- Upload custom network (GraphML/JSON)
- Compare against PathoMap interactome
- Calculate network similarity metrics
- Visualize overlap/unique edges

**Implementation**:
```python
# api/index.py
@app.post("/api/analysis/compare-networks")
async def compare_networks(file: UploadFile):
    user_network = parse_uploaded_network(file)
    pathomap_network = get_interactome_graph()
    comparison = compute_network_comparison(user_network, pathomap_network)
    return comparison
```

**Files to modify**:
- `api/index.py` (add network comparison endpoint)
- `src/pathomap/interactome.py` (add comparison methods)
- `index.html` (add Network Comparison section)
- `js/network-comparison.js` (new module)

**Success criteria**: Can upload network, see similarity metrics and visual comparison.

---

### 3.3 Real-Time ML Training on Subsets

**Why**: Researchers need to test hypotheses on data subsets.

**Changes**:
- Select subset of pathogens (by taxonomy, strategy, etc.)
- Train model on subset in real-time
- Compare subset model to full model
- Feature importance comparison

**Implementation**:
```python
# src/pathomap/ml/classifier.py
def train_on_subset(self, pathogen_names):
    subset_data = self.data[self.data['pathogen'].isin(pathogen_names)]
    model = RandomForestClassifier(**self.params)
    model.fit(subset_data[features], subset_data['strategy'])
    return model, self.evaluate(model, subset_data)
```

**Files to modify**:
- `src/pathomap/ml/classifier.py` (add subset training)
- `api/index.py` (add subset training endpoint)
- `js/ml-plots.js` (add subset selection UI)
- `index.html` (add subset controls)

**Success criteria**: Can select subset, train model, compare to full model.

---

### 3.4 Analysis Workflow Builder

**Why**: Researchers need reproducible, shareable pipelines.

**Changes**:
- Visual workflow editor (drag-and-drop)
- Chain analyses: enrichment → ML → network
- Export workflow as Python script
- Save and share workflows

**Implementation**:
```javascript
// js/workflow-builder.js (new file)
class WorkflowBuilder {
  steps = [];

  addStep(type, params) {
    this.steps.push({ type, params });
  }

  execute() {
    for (const step of this.steps) {
      await this.runStep(step);
    }
  }

  exportPython() {
    // generate executable Python script
  }
}
```

**Files to modify**:
- `js/workflow-builder.js` (new module)
- `index.html` (add Workflow Builder section)
- `api/index.py` (add workflow execution endpoint)

**Success criteria**: Can build multi-step workflow, execute, export as script.

---

## Technical Considerations

### Performance
- Cache computationally expensive results (ML training, network analysis)
- Use async endpoints for long-running analyses
- Add progress indicators for UI

### Data Storage
- Consider adding user-specific storage for saved analyses
- Version dataset exports (track which dataset version was used)
- Maintain backward compatibility

### Security
- Validate all user inputs (protein lists, sequences, networks)
- Sanitize uploaded files
- Rate limit expensive endpoints

### Testing
- Add tests for new analysis endpoints
- Test export formats open in external tools
- Test session save/load across different states

---

## De-emphasize Educational Elements

### Remove or Move
- Glossary page → move to `docs/glossary.md`
- "What this means" explanations → remove from UI
- Basic tutorials → move to `docs/tutorials.md`
- Simplified UI text → replace with technical terminology

### Replace with Research Language
- "Find out what X does" → "Analyze X features"
- "Learn about Y" → "Y methodology"
- "Explore the data" → "Query dataset"

---

## Timeline Estimate

| Phase | Duration | Features |
|-------|----------|----------|
| Phase 1 (Quick Wins) | 1-2 days | Methods section, high-res exports, network export, comparison view |
| Phase 2 (Medium) | 1-2 weeks | Custom enrichment, ML tuning, external links, session state |
| Phase 3 (Major) | 1-2 months | Sequence analysis, network comparison, subset ML, workflow builder |

**Total**: 1.5-2.5 months for full transformation.

---

## Success Metrics

- Time to first analysis (should be < 1 minute)
- Number of analysis tools (target: 8+)
- Export format variety (target: 5+ formats)
- Documentation coverage (all methods documented)
- Test coverage (maintain current levels, add for new features)

---

## Dependencies

- External databases: UniProt API, PHI-base API, IntAct API
- Bioinformatics: Biopython (already present), add sequence analysis libs
- Performance: Redis for caching (optional, for large analyses)
- File storage: Temporary storage for uploaded networks/sequences

---

## Next Steps

1. **Start with Phase 1** (quick wins) to establish research tone
2. **Gather feedback** from researchers on Phase 1 before proceeding
3. **Prioritize Phase 2** based on user needs
4. **Plan Phase 3** carefully - these are large architectural changes

---

## References

- IDR_ES: https://github.com/IPritisanac/IDR_ES
- Pattern: Streamlit for rapid analysis tools
- Pattern: Zenodo for large dataset distribution
- Pattern: Jupyter notebooks for reproducible analyses

---

## Additional Enhancements for Master's Applications

### 6. Real Literature Integration
**Why**: Professors want to see you engage with the primary literature, especially given your BIOD19 epigenetics coursework.

**Changes**:
- Add a `literature` table to the database with columns: pathogen_id, pubmed_id, title, journal, year, key_findings, knowledge_gap
- For each pathogen card, display:
  - Key papers on that pathogen's evasion mechanisms
  - DOI links to PubMed
  - Brief summary of what's known vs unknown
  - Gaps in current knowledge
- Add literature export (BibTeX format)

**Implementation**:
```python
# src/pathomap/data/seed/literature.csv
# Add literature data for each pathogen

# api/index.py
@app.get("/api/pathogens/{name}/literature")
async def get_pathogen_literature(name: str):
    literature = to_df("""
        SELECT pubmed_id, title, journal, year, key_findings, knowledge_gap
        FROM literature
        JOIN pathogens ON literature.pathogen_id = pathogens.id
        WHERE pathogens.name = ?
    """, (name,))
    return literature.to_dict("records")
```

**Files to modify**:
- `src/pathomap/data/seed/literature.csv` (new file)
- `src/pathomap/data/build_db.py` (add literature table)
- `api/index.py` (add literature endpoint)
- `js/script.js` (render literature in pathogen cards)

**Success criteria**: Each pathogen card shows 2-3 key papers with summaries and knowledge gaps.

---

### 7. Statistical Rigor Improvements
**Why**: Your classifier has ~37% accuracy - acknowledge this honestly but improve the analysis to show statistical maturity.

**Changes**:
- **Permutation testing**: Show classifier results are better than random chance
- **Confidence intervals**: Report for all metrics (accuracy, precision, recall, F1)
- **Multiple comparison correction**: Apply FDR/Bonferroni where appropriate (enrichment analysis)
- **Power analysis**: Discuss sample size limitations (54 pathogens, 250 effectors)
- **Effect sizes**: Report Cohen's d or similar for strategy comparisons
- **Bootstrap validation**: Add bootstrap confidence intervals to ML metrics

**Implementation**:
```python
# src/pathomap/ml/classifier.py
from scipy import stats

def permutation_test(model, X, y, n_permutations=1000):
    """Test if model performs better than random."""
    actual_score = model.score(X, y)
    perm_scores = []
    for _ in range(n_permutations):
        y_perm = np.random.permutation(y)
        perm_scores.append(model.score(X, y_perm))
    p_value = (np.sum(perm_scores >= actual_score) + 1) / (n_permutations + 1)
    return actual_score, p_value, perm_scores

def bootstrap_confidence_interval(scores, n_bootstrap=1000, alpha=0.05):
    """Calculate bootstrap CI for metrics."""
    boot_means = [np.mean(np.random.choice(scores, len(scores), replace=True))
                  for _ in range(n_bootstrap)]
    lower = np.percentile(boot_means, alpha/2 * 100)
    upper = np.percentile(boot_means, (1 - alpha/2) * 100)
    return lower, upper
```

**Files to modify**:
- `src/pathomap/ml/classifier.py` (add statistical tests)
- `src/pathomap/enrichment.py` (add FDR correction)
- `api/index.py` (expose statistical results)
- `js/ml-plots.js` (display confidence intervals in plots)

**Success criteria**: All ML metrics include confidence intervals, permutation tests show significance.

---

### 8. Enhanced Sequence-Based Analysis
**Why**: This is genuine bioinformatics research, not just visualization. Aligns with your single-cell omics background.

**Changes**:
- Calculate biophysical properties from sequences:
  - Hydrophobicity (Kyte-Doolittle scale)
  - Charge distribution (pI calculation)
  - Disorder prediction (IUPred2A)
  - Secondary structure prediction (PSIPRED)
  - Transmembrane regions (TMHMM)
  - Signal peptides (SignalP)
- Motif search across effectors (MEME suite integration)
- Sequence similarity clustering (BLAST or DIAMOND)
- Predict novel effectors from sequence features
- Compare sequence features to ML-predicted strategies

**Implementation**:
```python
# src/pathomap/sequence_analysis.py (new module)
from Bio.SeqUtils.ProtParam import ProteinAnalysis
from Bio import SeqIO

class SequenceAnalyzer:
    def __init__(self, sequence):
        self.seq = sequence
        self.analyzer = ProteinAnalysis(sequence)

    def calculate_features(self):
        """Calculate 144+ biophysical features."""
        return {
            'length': len(self.seq),
            'molecular_weight': self.analyzer.molecular_weight(),
            'isoelectric_point': self.analyzer.isoelectric_point(),
            'hydrophobicity': self._calculate_hydrophobicity(),
            'charge_distribution': self._calculate_charge_distribution(),
            'disorder_score': self._predict_disorder(),
            'secondary_structure': self._predict_secondary_structure(),
            'transmembrane_regions': self._predict_tm_regions(),
            'signal_peptide': self._predict_signal_peptide(),
            # ... more features
        }

    def find_similar_sequences(self, threshold=0.7):
        """Find similar sequences in the database."""
        # Use k-mer search or pairwise alignment
        pass

    def find_motifs(self, motif_database):
        """Search for known motifs."""
        pass
```

**Files to modify**:
- `src/pathomap/sequence_analysis.py` (new module)
- `src/pathomap/data/seed/effectors.csv` (add sequence column)
- `api/index.py` (add sequence analysis endpoints)
- `index.html` (add Sequence Analysis section)
- `js/sequence-analysis.js` (new module)

**Success criteria**: Can paste sequence, get comprehensive feature profile and similar effectors.

---

### 9. Connection to Lab Work
**Why**: Shows you can bridge computational work with wet-lab research, especially valuable for Terebiznik Lab context.

**Changes**:
- Add case studies on lab-specific pathogens (if applicable)
- Include data from your own experiments (if available/appropriate)
- Compare lab data to public database data
- Add "Experimental Validation" section showing computational predictions vs wet-lab results
- Include protocols for how to use the tool to analyze new data

**Implementation**:
```python
# src/pathomap/lab_integration.py (new module)
class LabDataIntegration:
    def upload_lab_data(self, file):
        """Parse lab-specific data formats."""
        pass

    def compare_to_database(self, lab_data):
        """Compare lab findings to PathoMap database."""
        pass

    def suggest_experiments(self, predictions):
        """Suggest experimental validations for computational predictions."""
        pass
```

**Files to modify**:
- `src/pathomap/lab_integration.py` (new module)
- `api/index.py` (add lab data endpoints)
- `index.html` (add Lab Integration section)

**Success criteria**: Can upload lab data, compare to database, get experiment suggestions.

---

### 10. Enhanced Network Analysis
**Why**: Network science is a growing field in systems biology. Show sophisticated analysis beyond basic visualization.

**Changes**:
- Add network topology metrics:
  - Betweenness centrality
  - Closeness centrality
  - Eigenvector centrality
  - Clustering coefficient
  - Network density
  - Modularity/community detection
- Add network comparison metrics:
  - Jaccard similarity
  - Graph edit distance
  - Shared neighbors
- Add temporal network analysis (if time-series data available)
- Add host-pathogen co-evolution analysis

**Implementation**:
```python
# src/pathomap/interactome.py (enhance existing)
def advanced_network_metrics(G):
    """Calculate comprehensive network metrics."""
    return {
        'betweenness': nx.betweenness_centrality(G),
        'closeness': nx.closeness_centrality(G),
        'eigenvector': nx.eigenvector_centrality(G),
        'clustering': nx.clustering(G),
        'modularity': nx.community.greedy_modularity_communities(G),
        'density': nx.density(G),
        'assortativity': nx.degree_assortativity_coefficient(G)
    }

def compare_networks(G1, G2):
    """Compare two networks."""
    return {
        'jaccard_similarity': jaccard_similarity(G1, G2),
        'graph_edit_distance': nx.graph_edit_distance(G1, G2),
        'shared_neighbors': shared_neighbors(G1, G2)
    }
```

**Files to modify**:
- `src/pathomap/interactome.py` (add advanced metrics)
- `api/index.py` (add network analysis endpoints)
- `js/network.js` (display advanced metrics)
- `index.html` (add network metrics section)

**Success criteria**: Network view shows comprehensive metrics, can compare networks.

---

### 11. Enhanced ML Pipeline
**Why**: Show sophisticated machine learning beyond basic classification.

**Changes**:
- Add multiple ML algorithms:
  - Support Vector Machines (SVM)
  - Gradient Boosting (XGBoost, LightGBM)
  - Neural Networks (simple feedforward)
  - Ensemble methods
- Add feature selection:
  - Recursive Feature Elimination (RFE)
  - L1 regularization (Lasso)
  - Mutual information
- Add model interpretation:
  - SHAP values
  - Partial dependence plots
  - Feature importance rankings
- Add uncertainty quantification:
  - Bayesian methods
  - Conformal prediction
  - Prediction intervals

**Implementation**:
```python
# src/pathomap/ml/advanced_classifier.py (new module)
from sklearn.ensemble import GradientBoostingClassifier, VotingClassifier
from sklearn.svm import SVC
import shap

class AdvancedMLPipeline:
    def __init__(self):
        self.models = {
            'random_forest': RandomForestClassifier(),
            'svm': SVC(probability=True),
            'gradient_boosting': GradientBoostingClassifier(),
            'ensemble': VotingClassifier(...)
        }

    def feature_selection(self, X, y, method='rfe'):
        """Select most important features."""
        pass

    def interpret_model(self, model, X):
        """Generate SHAP values for interpretation."""
        explainer = shap.TreeExplainer(model)
        shap_values = explainer.shap_values(X)
        return shap_values

    def quantify_uncertainty(self, X):
        """Add prediction intervals."""
        pass
```

**Files to modify**:
- `src/pathomap/ml/advanced_classifier.py` (new module)
- `api/index.py` (add advanced ML endpoints)
- `js/ml-plots.js` (add SHAP plots, feature selection UI)
- `index.html` (add advanced ML section)

**Success criteria**: Can train multiple models, compare performance, view SHAP interpretations.

---

### 12. Reproducibility Enhancements
**Why**: Leverage your Harvard Reproducible Science training - this is a major differentiator.

**Changes**:
- **DOI Integration**: Register dataset on Zenodo with permanent DOI
- **Automated Testing**: Add GitHub Actions CI/CD pipeline
- **Container Deployment**: Production-ready Docker with clear setup
- **Notebook Export**: Allow users to download analyses as Jupyter notebooks
- **Version Control**: Git tags for each release
- **Data Provenance**: Track data lineage (source → processing → output)
- **Computational Environment**: Conda environment file + Docker image

**Implementation**:
```yaml
# .github/workflows/ci.yml (new file)
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: |
          pip install -e ".[dev]"
      - name: Run tests
        run: pytest
      - name: Lint
        run: flake8 src/
```

```python
# scripts/export_notebook.py (new file)
"""Export analysis as reproducible Jupyter notebook."""
def generate_notebook(analysis_state):
    """Generate .ipynb file from analysis state."""
    nb = nbf.v4.new_notebook()
    # Add cells with analysis steps
    return nb
```

**Files to modify**:
- `.github/workflows/ci.yml` (new file)
- `Dockerfile` (enhance for production)
- `environment.yml` (new file)
- `scripts/export_notebook.py` (new file)
- `README.md` (add reproducibility section)

**Success criteria**: CI passes on every commit, DOI registered, notebook export works.

---

## Implementation Priority Order

### Week 1 (Before Applications Open) - CRITICAL
**Goal**: Immediate research credibility before application deadlines

1. ✅ **Add permutation testing + bootstrap confidence intervals to classifier**
   - File: `src/pathomap/ml/classifier.py`
   - Add `permutation_test()` function to show model > random chance
   - Add `bootstrap_confidence_interval()` for cross-validation scores
   - Expose via API endpoint `/api/ml/statistical-rigour`
   - **Why**: Shows statistical maturity, honest about 37% accuracy

2. ✅ **Add "How to Cite" section with DOI placeholder**
   - File: `index.html`
   - Add citation section with BibTeX format
   - Include version number (v0.4.0)
   - Add Zenodo DOI placeholder (can register later)
   - **Why**: Shows understanding of academic conventions

3. ✅ **Add Methods section documenting all algorithms**
   - File: `index.html` (add before Database section)
   - Document: trafficking prediction, enrichment analysis, ML features
   - Include pseudocode for key algorithms
   - Link to detailed documentation in ONBOARDING.md
   - **Why**: Research tools prioritize methodology over explanations

4. ✅ **Add research question prominently to homepage**
   - File: `index.html`
   - Add "Research Objectives" section at top
   - State core question: "Do effector protein sequence features predict intracellular survival strategies?"
   - Add working hypothesis
   - **Why**: Immediately shifts perception from educational to research-focused

5. ✅ **Add external database links (UniProt, PHI-base, IntAct)**
   - File: `src/pathomap/data/seed/host_proteins.csv` (add uniprot_id column)
   - File: `src/pathomap/data/seed/effectors.csv` (add phi_base_id column)
   - File: `api/index.py` (add link generation)
   - File: `js/database.js` (render clickable links in tables)
   - **Why**: Shows integration with real scientific databases

### Week 2-3 (Application Season) - HIGH PRIORITY
**Goal**: Demonstrate computational biology skills relevant to target professors

6. ✅ **Add sequence-based feature extraction module**
   - File: `src/pathomap/sequence_analysis.py` (NEW)
   - Compute **450 features** per sequence: amino-acid composition (20),
     dipeptide composition (400), physicochemical (length, MW, aromaticity,
     instability index, isoelectric point, GRAVY/Kyte-Doolittle), net charge at
     pH 7, and disorder (TOP-IDP mean, FoldIndex). Built on Biopython
     `ProteinAnalysis`.
   - API: `POST /api/sequence/analyze`, `GET /api/sequence/coverage`,
     `GET /api/effectors/{name}/sequence-features`
   - **Real sequences** (not synthetic): `scripts/fetch_effector_sequences.py`
     resolves each curated effector to a canonical UniProtKB entry and caches
     the sequence + provenance in `src/pathomap/data/seed/effector_sequences.csv`.
   - **Provenance / integrity**: matching is **gene-only** (curated alias map +
     optional taxon renames); a free-text fallback was removed after it produced
     confidently wrong hits (e.g. `LAM` → an RNA polymerase sigma factor,
     `LPS`/`CPS` → a tyrosine kinase). Non-polypeptide effectors (`LAM`, `LPS`,
     `CPS`, `Alginate`, `K1 capsule`) are never mapped. Coverage: **191/250
     (76.4%; 103 reviewed/Swiss-Prot)**; the 59 gaps are recorded with a reason
     in the `note` column rather than guessed.
   - **Why**: Core bioinformatics skill, directly relevant to Ensminger/Guttman/Terebiznik

7. ✅ **Add high-res figure export (PNG + SVG)**
   - File: `js/figure-export.js` (NEW utility module)
   - Adds "PNG" buttons to every Chart.js canvas and "SVG"/"PNG" buttons to the
     D3 interactome network and effector phylogeny.
   - Includes a metadata footer (dataset version, date, optional parameters).
   - Pixel-scaled (2×) export, labelled honestly as high-resolution rather than
     a literal physical 300 DPI. Verified by `tests/frontend/figure_export_checks.js`.
   - **Why**: Researchers need publication-quality figures

8. ✅ **Add literature integration for key pathogens**
   - File: `src/pathomap/data/seed/literature.csv` (NEW)
   - Columns: `pathogen_name, pubmed_id, title, journal, year, authors,
     key_findings, knowledge_gap, query, fetched_utc`
   - **Real records** fetched from the NCBI E-utilities API by
     `scripts/fetch_literature.py` (resumable; every row stores its exact query
     and fetch timestamp). 162 references across all 54 pathogens.
   - `key_findings`/`knowledge_gap` are intentionally blank pending human
     curation — not machine-authored.
   - API: `GET /api/pathogens/{name}/literature`, `GET /api/literature`,
     `GET /api/literature/coverage`; rendered as PubMed links in pathogen cards.
   - **Why**: Shows engagement with primary literature, highlights knowledge gaps

9. ✅ **Add enhanced network metrics**
   - File: `src/pathomap/interactome.py` (enhanced existing)
   - Added betweenness/closeness/eigenvector centrality, average clustering,
     density, degree assortativity (NaN-guarded), and modularity/community
     detection, plus `compare_networks()` (node/edge Jaccard, shared-neighbour
     similarity, bounded graph edit distance — GED skipped above 40 nodes).
   - API: `/api/interactome/metrics`, `/api/interactome/metrics/{name}`,
     `/api/interactome/compare`.
   - **Why**: Sophisticated network analysis beyond basic visualization

### Week 4-6 (Advanced Features) - MEDIUM PRIORITY
**Goal**: Differentiate from other applicants with advanced ML capabilities

10. ✅ **Add enhanced ML pipeline with model interpretation**
    - File: `src/pathomap/ml/advanced_classifier.py` (NEW)
    - Model zoo: Random Forest, Gradient Boosting, SVM (RBF), Logistic
      Regression, k-NN, and a small Neural Net (MLP), compared with **repeated
      stratified CV** and bootstrap confidence intervals.
    - Feature selection: mutual information, L1 (one-vs-rest logistic), and RFE.
    - Interpretation via **SHAP when the optional `shap` extra is installed**,
      otherwise an honest permutation-importance fallback (`method` reports
      which was used). Partial-dependence data exposed for any feature.
    - `nested_cv()` gives an unbiased estimate with hyperparameter tuning in an
      inner loop.
    - API: `/api/ml/advanced/{models,nested-cv,feature-selection,interpretation,partial-dependence,pipeline}`.
    - Results are labelled **exploratory** (small classes).
    - **Why**: Shows sophisticated ML beyond basic classification

11. ✅ **Add novel finding discovery module**
    - File: `src/pathomap/novel_findings.py` (NEW)
    - Welch's t-test per (sequence feature, strategy) with **Benjamini-Hochberg
      FDR** control; groups smaller than `min_group_size` (default 6) skipped.
    - Reports e.g. "AA-composition enriched in escape (q=0.01, d=+1.2)"; every
      finding is explicitly a **hypothesis**.
    - API: `/api/novel-findings`, `/api/novel-findings/report`.
    - **Why**: Shows you can generate hypotheses from data, bridge comp + experimental

12. ⬜ **Add connection to lab work**
    - File: `src/pathomap/lab_integration.py` (NEW)
    - Add case studies on lab-specific pathogens
    - Include data from your own experiments (if appropriate)
    - Add "Experimental Validation" section
    - **Why**: Shows ability to bridge computational work with wet-lab research
    - **Status: deferred** — requires wet-lab data we do not have. Left open
      rather than fabricated.

### Week 7-8 (Reproducibility) - OPTIONAL BUT VALUABLE
**Goal**: Leverage Harvard Reproducible Science training

13. ✅ **Add CI/CD pipeline with GitHub Actions**
    - File: `.github/workflows/ci.yml` (NEW)
    - Automated testing on every commit (pytest across Python 3.11/3.12)
    - Linting with **ruff** (configured in `pyproject.toml`; flake8 was the
      original suggestion but ruff is used as the single fast linter)
    - Also runs the headless frontend checks under Node 20.
    - **Why**: Shows professional software engineering standards

14. ✅ **Register dataset on Zenodo with DOI**
    - Prepared the deposit package: `.zenodo.json`, `CITATION.cff`,
      `docs/zenodo-deposit.md` (step-by-step instructions), and
      `scripts/prepare_zenodo_deposit.py` (builds `dist/pathomap-v0.4.0.zip`
      + SHA-256 checksum).
    - **DOI remains a placeholder** (`10.5281/zenodo.XXXXXXX`) and the creator
      name/ORCID are clearly marked placeholders to fill in — no account or
      token is required to build the package.
    - **Why**: Permanent identifier, citable dataset

15. ✅ **Add notebook export functionality**
    - File: `scripts/export_notebook.py` (NEW) generates five nbformat-4
      notebooks (dataset overview, strategy classifier, sequence features,
      network analysis, novel findings) into
      `src/pathomap/data/notebooks/` with a `manifest.json`.
    - Served for download via `/api/notebooks` (+ `/{slug}`) and a
      "Reproducible Notebooks" panel in the Methods section (`js/notebooks.js`).
    - Static templates only — nothing is generated at request time.
    - **Why**: Enables research reproducibility

---

## Success Metrics for Master's Applications

### Technical Metrics
- [x] Research question clearly stated on homepage
- [ ] All proteins/effectors have external database links
      (effectors link to PHI-base search; host proteins to UniProt where an
      accession exists — records without one deliberately show a dash)
- [x] All visualizations export in high-res formats
- [x] Citation format available with DOI placeholder
- [x] Methods section documents all algorithms
- [x] Literature integrated for each pathogen (all 54, real PubMed records)
- [x] Statistical tests include confidence intervals
- [x] Sequence analysis provides 144+ features (450, on 191 real UniProt sequences)
- [ ] ML pipeline includes SHAP interpretations
      (SHAP supported via the optional `shap` extra; falls back to permutation
      importance because it is not installed by default)
- [x] CI/CD pipeline passes on every commit (ruff + pytest + node locally)
- [ ] Dataset registered on Zenodo with DOI (deposit package ready; DOI is a
      placeholder until the user publishes)

### Application Metrics
- [ ] Personal statement incorporates research question
- [ ] Can explain biological rationale for each feature
- [ ] Can discuss limitations honestly
- [ ] Can demonstrate tool to professors
- [ ] Can export publication-ready figures
- [ ] Can show reproducibility standards
- [ ] Can connect to lab work (if applicable)

---

## Final Recommendations

### Before Applications (1-2 weeks minimum)
**Must complete**:
1. Research question on homepage
2. External database links
3. High-res exports
4. Citation format
5. Methods section
6. Statistical rigor improvements

**Should complete if time**:
7. Literature integration
8. Enhanced network metrics
9. CI/CD pipeline

### During Application Season
**Be prepared to**:
- Demo the tool to professors (practice 5-minute demo)
- Explain the research question and hypothesis
- Discuss limitations honestly
- Show publication-ready exports
- Talk about reproducibility

### After Applications (Ongoing)
**Continue adding**:
- Sequence analysis features
- Advanced ML pipeline
- Lab data integration
- More pathogens to database
- Publication based on the tool

---

## Closing Thoughts

Your PathoMap project is already impressive. The key to making it stand out for master's applications is:

1. **Emphasize the biology question**, not just the technical implementation
2. **Show reproducibility standards** (Harvard training is a huge asset)
3. **Connect to real databases** (UniProt, PHI-base, IntAct)
4. **Be honest about limitations** (shows scientific maturity)
5. **Demonstrate publication-ready outputs** (researchers love this)

Your combination of biology + CS + reproducible science training is exactly what computational biology programs want. Lean into this identity and you'll have a strong application.

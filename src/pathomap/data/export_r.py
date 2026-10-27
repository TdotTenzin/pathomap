"""
export_r.py — Export simulated datasets from Python to R's data directory.

Generates:
  1. Simulated RNA-seq count matrix (DESeq2-style)
  2. Sample metadata (condition = infected vs control)
  3. Pathway database from our curated host proteins
  4. Network metrics from the interactome analysis

These files live in r/data/ and are read by the R scripts.
"""

import pathlib
import random

import numpy as np
import pandas as pd

from pathomap.data.loader import to_df

R_DATA = pathlib.Path("r") / "data"


def export_counts():
    """
    Generate a simulated RNA-seq count matrix.

    20 host genes x 6 samples (3 infected, 3 control).
    Infected samples have differential expression in trafficking genes,
    mimicking a real host transcriptional response to infection.

    The design: 10 genes are truly DE (log2FC ~ ±2), 10 are non-DE.
    """
    random.seed(42)
    np.random.seed(42)

    # Get host gene names from our database
    genes = to_df("SELECT name FROM host_proteins ORDER BY name")
    gene_list = genes["name"].tolist()

    # Pick 20 representative genes (all from our DB)
    selected = gene_list[:20]
    n_genes = len(selected)
    n_samples = 6  # 3 infected, 3 control

    # Base expression levels (log2 scale)
    base_means = np.random.lognormal(mean=4, sigma=0.5, size=n_genes)

    # Assign log2 fold changes: first 10 genes are DE
    log2fc = np.zeros(n_genes)
    for i in range(10):
        log2fc[i] = np.random.choice([-2.5, -2.0, -1.8, 1.8, 2.0, 2.5])

    # Build count matrix
    counts = np.zeros((n_genes, n_samples), dtype=int)
    for i in range(n_genes):
        for j in range(n_samples):
            # Samples 0-2 are infected (log2fc applied), samples 3-5 are control
            fc = log2fc[i] if j < 3 else 0.0
            mean_expr = base_means[i] * (2 ** fc)
            # Add Poisson noise
            counts[i, j] = max(0, int(np.random.poisson(mean_expr)))

    # Create DataFrames
    count_df = pd.DataFrame(
        counts,
        index=selected,
        columns=[f"infected_{i+1}" for i in range(3)] + [f"control_{i+1}" for i in range(3)],
    )
    count_df.index.name = "gene"

    col_data = pd.DataFrame({
        "sample": count_df.columns,
        "condition": ["infected"] * 3 + ["control"] * 3,
    })

    # Mark which genes are truly DE for validation
    de_df = pd.DataFrame({
        "gene": selected,
        "log2fc_true": log2fc,
        "is_de": [abs(fc) > 1 for fc in log2fc],
    })

    count_df.to_csv(R_DATA / "deseq2_counts.csv")
    col_data.to_csv(R_DATA / "deseq2_colData.csv", index=False)
    de_df.to_csv(R_DATA / "de_ground_truth.csv", index=False)

    print(f"Exported count matrix: {count_df.shape}")
    print(f"  Samples: {', '.join(count_df.columns)}")
    print(f"  DE genes: {sum(log2fc != 0)}")
    return count_df


def export_pathway_db():
    """
    Export the curated pathway database for R enrichment analysis.
    """
    df = to_df("SELECT name, pathway FROM host_proteins WHERE pathway IS NOT NULL")
    df.to_csv(R_DATA / "pathway_db.csv", index=False)
    print(f"Exported pathway DB: {len(df)} proteins in {df['pathway'].nunique()} pathways")
    return df


def export_network_metrics():
    """
    Compute and export network centrality scores for R visualizations.
    """
    from pathomap.interactome import build_network, hub_targets

    G = build_network()
    hubs = hub_targets(G, top_n=20)
    df = pd.DataFrame(hubs)
    df.to_csv(R_DATA / "network_metrics.csv", index=False)
    print(f"Exported network metrics: {len(df)} proteins")
    return df


def export_all():
    """Run all exports."""
    R_DATA.mkdir(parents=True, exist_ok=True)
    export_counts()
    export_pathway_db()
    export_network_metrics()
    print("\nAll exports written to r/data/")


if __name__ == "__main__":
    export_all()

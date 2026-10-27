"""
dimred.py — Dimensionality reduction for host response profiles.

Applies PCA and UMAP to the simulated RNA-seq expression data to
visualise how infected samples cluster away from controls.
Also supports reduction of the effector feature matrix for pathogen
strategy visualisation.

Optimizations:
  - Fixed relative path to use pathlib for cross-platform compatibility
  - Graceful fallback when umap-learn is not installed
"""

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from pathomap.data.loader import to_df

# Absolute path to R data directory (<repo root>/r/data)
_R_DATA_DIR = Path(__file__).resolve().parents[3] / "r" / "data"


def _get_expression_matrix() -> tuple[pd.DataFrame, list[str]]:
    # Try loading from R exports first (richer data)
    try:
        counts_path = _R_DATA_DIR / "deseq2_counts.csv"
        if counts_path.exists():
            counts = pd.read_csv(str(counts_path), index_col=0)
            log_expr = np.log2(counts + 1)
            labels = ["infected"] * 3 + ["control"] * 3
            return log_expr.T, labels
    except (FileNotFoundError, pd.errors.EmptyDataError):
        pass

    # Fallback: build from host_proteins with random expression
    df = to_df("SELECT name FROM host_proteins")
    genes = df["name"].tolist()
    rng = np.random.default_rng(42)
    data = rng.lognormal(mean=4, sigma=0.5, size=(len(genes), 6))
    expr = pd.DataFrame(
        np.log2(data + 1),
        index=genes,
        columns=[f"infected_{i+1}" for i in range(3)]
        + [f"control_{i+1}" for i in range(3)],
    )
    labels = ["infected"] * 3 + ["control"] * 3
    return expr.T, labels


def _standardize(df: pd.DataFrame) -> pd.DataFrame:
    """Z-score a numeric DataFrame, guarding against constant columns."""
    mean = df.mean(axis=0)
    std = df.std(axis=0, ddof=0).replace(0, 1.0)
    return (df - mean) / std


def pca_from_matrix(
    df: pd.DataFrame,
    labels: list[str] | None = None,
    n_components: int = 2,
) -> dict:
    """
    Run PCA on an arbitrary numeric matrix.

    Parameters:
        df: samples (rows) x features (columns).
        labels: optional per-row group label, mirrored onto each sample.
        n_components: number of principal components to keep.

    Returns a dict with explained_variance_ratio, cumulative_variance,
    n_components, top features for PC1, and a `samples` list of records.
    """
    X = _standardize(df)

    pca = PCA(n_components=min(n_components, X.shape[0], X.shape[1]))
    X_pca = pca.fit_transform(X.to_numpy())

    loadings = pd.DataFrame(pca.components_, columns=X.columns)
    top_features_pc = (
        loadings.iloc[0]
        .abs()
        .sort_values(ascending=False)
        .head(5)
        .index.tolist()
        if pca.n_components_ > 0
        else []
    )

    samples = []
    for i in range(X_pca.shape[0]):
        row = {"condition": labels[i] if labels else "sample"}
        for c in range(pca.n_components_):
            row[f"PC{c + 1}"] = round(float(X_pca[i, c]), 6)
        samples.append(row)

    return {
        "explained_variance_ratio": [
            round(float(v), 4) for v in pca.explained_variance_ratio_
        ],
        "cumulative_variance": round(float(np.cumsum(pca.explained_variance_ratio_)[-1]), 4),
        "n_components": pca.n_components_,
        "top_genes_pc1": top_features_pc,
        "samples": samples,
        "feature_names": list(X.columns),
    }


def umap_from_matrix(
    df: pd.DataFrame,
    labels: list[str] | None = None,
    n_neighbors: int = 5,
    min_dist: float = 0.3,
) -> dict:
    """
    Run UMAP on an arbitrary numeric matrix (samples x features).

    Returns {"n_neighbors", "min_dist", "samples"} where each sample carries
    UMAP1/UMAP2 plus a `condition` label. Degrades gracefully to an error dict
    when umap-learn is not installed.
    """
    try:
        from umap import UMAP
    except ImportError:
        return {
            "error": "umap-learn is not installed. Install with: pip install umap-learn",
            "n_neighbors": n_neighbors,
            "min_dist": min_dist,
            "samples": [],
        }

    X = _standardize(df)
    reducer = UMAP(n_neighbors=n_neighbors, min_dist=min_dist, random_state=42)
    X_umap = reducer.fit_transform(X.to_numpy())

    samples = []
    for i in range(X_umap.shape[0]):
        samples.append(
            {
                "condition": labels[i] if labels else "sample",
                "UMAP1": round(float(X_umap[i, 0]), 6),
                "UMAP2": round(float(X_umap[i, 1]), 6),
            }
        )

    return {
        "n_neighbors": n_neighbors,
        "min_dist": min_dist,
        "samples": samples,
    }


def pca_analysis(n_components: int = 2) -> dict:
    X, labels = _get_expression_matrix()
    return pca_from_matrix(X, labels=labels, n_components=n_components)


def umap_analysis(n_neighbors: int = 5, min_dist: float = 0.3) -> dict:
    X, labels = _get_expression_matrix()
    return umap_from_matrix(X, labels=labels, n_neighbors=n_neighbors, min_dist=min_dist)


def pathogen_feature_pca() -> dict:
    from pathomap.ml.classifier import extract_features

    X, y = extract_features()

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    n = min(2, X_scaled.shape[0], X_scaled.shape[1])
    pca = PCA(n_components=n)
    X_pca = pca.fit_transform(X_scaled)

    all_names = to_df("SELECT name FROM pathogens ORDER BY name")["name"].tolist()

    samples = []
    for i in range(X_pca.shape[0]):
        samples.append(
            {
                "pathogen": all_names[i],
                "strategy": y.iloc[i],
                "PC1": round(float(X_pca[i, 0]), 4),
                "PC2": round(float(X_pca[i, 1]), 4) if n > 1 else 0.0,
            }
        )

    return {
        "explained_variance_ratio": [
            round(float(v), 4) for v in pca.explained_variance_ratio_
        ],
        "samples": samples,
        "feature_names": list(X.columns),
    }

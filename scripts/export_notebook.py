"""
export_notebook.py — Generate downloadable, reproducible analysis notebooks.

Rather than hand-maintaining notebook files, this script builds them from small
Python templates that call the real `pathomap` modules. Re-running it keeps the
notebooks in sync with the current API surface.

Output:
    src/pathomap/data/notebooks/<slug>.ipynb   (valid nbformat 4 notebooks)
    src/pathomap/data/notebooks/manifest.json  (title/description index)

The notebooks are served for download by the API (`/api/notebooks`), so users
can run the analyses themselves. This is a build step — nothing is generated at
request time.

Usage:
    python scripts/export_notebook.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "src" / "pathomap" / "data" / "notebooks"


def md(text: str) -> dict:
    return {
        "cell_type": "markdown",
        "metadata": {},
        "source": text.strip("\n").splitlines(keepends=True),
    }


def code(text: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": text.strip("\n").splitlines(keepends=True),
    }


def notebook(cells: list[dict]) -> dict:
    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {"name": "python", "version": "3.11"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


# Each entry: (slug, title, description, cells)
TEMPLATES: list[tuple[str, str, str, list[dict]]] = []

TEMPLATES.append((
    "dataset-overview",
    "Dataset overview",
    "Load the curated host-pathogen dataset and summarise pathogens, effectors and host targets.",
    [
        md("# Dataset overview\n\nExplore the curated PathoMap database.")
        ,
        code("""
from pathomap.data.loader import query, to_df

pathogens = to_df("SELECT name, gram_stain, strategy FROM pathogens ORDER BY name")
print(f"{len(pathogens)} pathogens")
pathogens.head(10)
"""),
        code("""
effectors = to_df(\"\"\"
    SELECT p.name AS pathogen, e.name AS effector, e.type, e.host_target
    FROM effectors e JOIN pathogens p ON e.pathogen_id = p.id
    ORDER BY p.name, e.name
\"\"\")
print(f"{len(effectors)} effectors across {effectors['pathogen'].nunique()} pathogens")
effectors['type'].value_counts().head(10)
"""),
    ],
))

TEMPLATES.append((
    "strategy-classifier",
    "Survival-strategy classifier",
    "Train and cross-validate the Random Forest that predicts a pathogen's intracellular survival strategy.",
    [
        md("# Survival-strategy classifier\n\nPredict `strategy` from 11 effector-derived features.")
        ,
        code("""
from pathomap.ml.classifier import extract_features, cross_validate_rf

X, y = extract_features()
print(X.shape, "features;", y.nunique(), "strategies")
y.value_counts()
"""),
        code("""
result = cross_validate_rf()
print(f"5-fold accuracy: {result['accuracy']:.2%} ({result['n_correct']}/{len(result['folds'])})")
"""),
        code("""
# Wider model comparison
from pathomap.ml.advanced_classifier import compare_models
for m in compare_models(n_repeats=3)["models"]:
    print(f"{m['model']:22s} {m['mean_accuracy']:.3f} +/- {m['std_accuracy']:.3f}")
"""),
    ],
))

TEMPLATES.append((
    "sequence-features",
    "Effector sequence features",
    "Compute 450 sequence features per effector and inspect coverage of the resolved UniProt set.",
    [
        md("# Effector sequence features\n\n450 features: amino-acid and dipeptide composition, physicochemical, charge and disorder.")
        ,
        code("""
from pathomap.sequence_analysis import (
    sequence_coverage, load_effector_sequences, sequence_features, sequence_feature_names,
)

print(sequence_coverage())
records = load_effector_sequences()
print(f"{len(records)} resolved sequences")
"""),
        code("""
first = records[0]
feats = sequence_features(first["sequence"])
print(first["effector_name"], "->", len(feats), "features")
{k: feats[k] for k in sequence_feature_names()[:8]}
"""),
    ],
))

TEMPLATES.append((
    "network-analysis",
    "Host-pathogen network analysis",
    "Build the effector/host-protein network and compute centrality and community metrics.",
    [
        md("# Host-pathogen network analysis\n\nCentrality, clustering and modularity over the interaction graph.")
        ,
        code("""
from pathomap.interactome import build_network, network_stats, advanced_network_metrics

G = build_network()
print(network_stats(G))
metrics = advanced_network_metrics(G, top_n=10)
print("density:", metrics["density"])
metrics["top_betweenness"][:10]
"""),
    ],
))

TEMPLATES.append((
    "novel-findings",
    "Novel findings (feature vs strategy)",
    "Welch's t-tests with Benjamini-Hochberg FDR control comparing sequence features across survival strategies.",
    [
        md("# Novel findings\n\n**Hypothesis-generating** analysis — every result is a candidate for follow-up, not a conclusion.")
        ,
        code("""
from pathomap.novel_findings import feature_strategy_association

result = feature_strategy_association(min_group_size=6, fdr=0.05)
print(f"{result['n_sequences']} sequences, {result['n_tests']} tests, {result['n_significant']} significant")
for f in result["findings"][:20]:
    print(f["statement"])
"""),
    ],
))


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    for slug, title, description, cells in TEMPLATES:
        nb = notebook(cells)
        path = OUT_DIR / f"{slug}.ipynb"
        with path.open("w", encoding="utf-8") as f:
            json.dump(nb, f, indent=1, ensure_ascii=False)
            f.write("\n")
        manifest.append({
            "slug": slug,
            "title": title,
            "description": description,
            "filename": f"{slug}.ipynb",
        })
        print(f"wrote {path.relative_to(ROOT)} ({len(cells)} cells)")

    with (OUT_DIR / "manifest.json").open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(manifest)} notebooks + manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
novel_findings.py — Hypotheses from sequence features vs evasion strategy.

Compares each sequence-derived feature (amino-acid composition, dipeptide
composition, physicochemical properties, charge, disorder) between pathogens
sharing a given intracellular survival strategy and all other pathogens, using
Welch's t-test. P-values are corrected for multiple comparisons with the
Benjamini-Hochberg false-discovery-rate procedure.

These are **hypotheses**, not conclusions. With a few hundred sequences across
six strategies, and groups as small as `min_group_size`, the goal is to surface
candidate features worth experimental follow-up, and to say so explicitly.
"""

from __future__ import annotations

import warnings
from functools import lru_cache

import numpy as np
import pandas as pd

from pathomap.data.loader import to_df
from pathomap.sequence_analysis import (
    load_effector_sequences,
    sequence_feature_names,
    sequence_features,
)

NOTE = (
    "Hypothesis-generating analysis of a small curated dataset; "
    "not a validated result. Treat every finding as a candidate for follow-up."
)


def _benjamini_hochberg(pvals: list[float]) -> np.ndarray:
    """Benjamini-Hochberg FDR-adjusted q-values (step-up, monotone)."""
    p = np.asarray(pvals, dtype=float)
    n = p.size
    if n == 0:
        return p
    order = np.argsort(p)
    ranked = p[order]
    q = ranked * n / np.arange(1, n + 1)
    # enforce monotonicity from the largest p-value down
    q = np.minimum.accumulate(q[::-1])[::-1]
    q = np.clip(q, 0.0, 1.0)
    out = np.empty(n, dtype=float)
    out[order] = q
    return out


@lru_cache(maxsize=1)
def build_sequence_feature_table() -> pd.DataFrame:
    """
    One row per resolved effector sequence, with its 450 sequence features and
    the survival strategy of the pathogen it came from.
    """
    strategies = {
        r["name"]: r["strategy"]
        for r in to_df("SELECT name, strategy FROM pathogens").to_dict("records")
    }
    rows: list[dict] = []
    for rec in load_effector_sequences():
        seq = (rec.get("sequence") or "").strip()
        if not seq:
            continue
        strategy = strategies.get(rec["pathogen_name"])
        if not strategy:
            continue
        try:
            feats = sequence_features(seq)
        except Exception:
            continue
        feats["effector"] = rec["effector_name"]
        feats["pathogen"] = rec["pathogen_name"]
        feats["strategy"] = strategy
        rows.append(feats)
    df = pd.DataFrame(rows)
    return df


def _cohens_d(a: np.ndarray, b: np.ndarray) -> float:
    """Standardised mean difference (pooled SD), guarded against zero variance."""
    n1, n2 = len(a), len(b)
    if n1 < 2 or n2 < 2:
        return 0.0
    var1, var2 = a.var(ddof=1), b.var(ddof=1)
    pooled = np.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2))
    if pooled == 0 or not np.isfinite(pooled):
        return 0.0
    return float((a.mean() - b.mean()) / pooled)


def feature_strategy_association(
    min_group_size: int = 6,
    fdr: float = 0.05,
    max_findings: int = 100,
) -> dict:
    """
    For every (feature, strategy) pair, test whether the feature differs between
    sequences in that strategy and all others (Welch's t-test), then apply
    Benjamini-Hochberg FDR control across all tests.

    Groups smaller than `min_group_size` are skipped, so a "finding" is never
    driven by one or two sequences.
    """
    from scipy import stats

    df = build_sequence_feature_table()
    if df.empty:
        return {"n_sequences": 0, "findings": [], "note": NOTE}

    feature_cols = [c for c in sequence_feature_names() if c in df.columns]
    strategies = sorted(df["strategy"].dropna().unique())

    tests: list[dict] = []
    group_sizes: dict[str, int] = {}
    for strat in strategies:
        group = df[df["strategy"] == strat]
        rest = df[df["strategy"] != strat]
        n_group, n_rest = len(group), len(rest)
        group_sizes[strat] = n_group
        if n_group < min_group_size or n_rest < min_group_size:
            continue
        for feat in feature_cols:
            a = group[feat].to_numpy(dtype=float)
            b = rest[feat].to_numpy(dtype=float)
            if np.allclose(a.std(), 0.0) and np.allclose(b.std(), 0.0):
                continue
            # Near-constant features can trigger scipy's precision-loss warning;
            # any non-finite p-value is discarded below regardless.
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                statistic, p = stats.ttest_ind(a, b, equal_var=False)
            if not np.isfinite(p):
                continue
            d = _cohens_d(a, b)
            tests.append({
                "feature": feat,
                "strategy": strat,
                "n_group": n_group,
                "n_rest": n_rest,
                "mean_group": round(float(a.mean()), 4),
                "mean_rest": round(float(b.mean()), 4),
                "effect_size": round(d, 4),
                "direction": "enriched" if a.mean() > b.mean() else "depleted",
                "statistic": round(float(statistic), 4),
                "p_value": float(p),
            })

    if not tests:
        return {
            "n_sequences": int(len(df)),
            "n_tests": 0,
            "findings": [],
            "group_sizes": group_sizes,
            "min_group_size": min_group_size,
            "fdr": fdr,
            "note": NOTE,
        }

    qvals = _benjamini_hochberg([t["p_value"] for t in tests])
    for t, q in zip(tests, qvals):
        t["p_value"] = round(t["p_value"], 6)
        t["q_value"] = round(float(q), 6)

    significant = [t for t in tests if t["q_value"] <= fdr]
    significant.sort(key=lambda t: (t["q_value"], -abs(t["effect_size"])))

    for t in significant:
        t["statement"] = (
            f"{t['feature']} {t['direction']} in {t['strategy']} "
            f"(q={t['q_value']:.3g}, Cohen's d={t['effect_size']:+.2f})"
        )

    return {
        "n_sequences": int(len(df)),
        "n_features": len(feature_cols),
        "n_tests": len(tests),
        "n_significant": len(significant),
        "findings": significant[:max_findings],
        "group_sizes": group_sizes,
        "min_group_size": min_group_size,
        "fdr": fdr,
        "note": NOTE,
    }


def novel_findings_report() -> dict:
    """Top-level report combining the FDR-controlled findings with context."""
    result = feature_strategy_association()
    return {
        "analysis": result,
        "method": (
            "Welch's t-test per (sequence feature, strategy) with "
            "Benjamini-Hochberg FDR control"
        ),
        "note": NOTE,
    }

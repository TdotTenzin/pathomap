"""
Tests for the novel-findings module (src/pathomap/novel_findings.py).
"""

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from pathomap.novel_findings import (  # noqa: E402
    _benjamini_hochberg,
    build_sequence_feature_table,
    feature_strategy_association,
    novel_findings_report,
)


def test_bh_matches_known_example():
    # For p = [0.01, 0.02, 0.03, 0.04, 0.05], n=5, the adjusted p-values are
    # all 0.05 under the step-up procedure.
    q = _benjamini_hochberg([0.01, 0.02, 0.03, 0.04, 0.05])
    assert np.allclose(q, 0.05)


def test_bh_is_monotone_and_bounded():
    q = _benjamini_hochberg([0.001, 0.2, 0.04, 0.9, 0.5])
    assert np.all(q >= 0) and np.all(q <= 1)
    order = np.argsort([0.001, 0.2, 0.04, 0.9, 0.5])
    assert np.all(np.diff(q[order]) >= -1e-12)


def test_feature_table_is_non_empty_and_has_strategy():
    df = build_sequence_feature_table()
    assert len(df) > 0
    assert {"effector", "pathogen", "strategy"} <= set(df.columns)
    assert df["strategy"].nunique() >= 2


def test_association_applies_fdr_and_group_floor():
    result = feature_strategy_association(min_group_size=6, fdr=0.05)
    assert result["n_sequences"] > 0
    assert result["n_tests"] > 0
    assert result["min_group_size"] == 6

    # Every reported finding must be significant after correction and meet the
    # group-size floor.
    for f in result["findings"]:
        assert f["q_value"] <= 0.05
        assert f["n_group"] >= 6
        assert f["n_rest"] >= 6
        assert f["direction"] in {"enriched", "depleted"}
        assert "statement" in f
    # q >= p up to rounding
    for f in result["findings"]:
        assert f["q_value"] + 1e-6 >= f["p_value"]


def test_findings_are_sorted_by_q_value():
    result = feature_strategy_association()
    qs = [f["q_value"] for f in result["findings"]]
    assert qs == sorted(qs)


def test_report_carries_caveat():
    report = novel_findings_report()
    assert "analysis" in report
    assert "Welch" in report["method"]
    assert "Hypothesis" in report["note"]

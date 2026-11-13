"""Known-answer tests for shared analysis helpers."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from analysis_common import bh_adjust, hypergeom_sf, jaccard, median


class AnalysisCommonTests(unittest.TestCase):
    def test_hypergeometric_survival(self):
        # 3 foreground proteins, 3 background members out of 10, all 3 observed.
        self.assertAlmostEqual(hypergeom_sf(3, 10, 3, 3), 1 / 120, places=9)

    def test_hypergeometric_edge_cases(self):
        self.assertEqual(hypergeom_sf(0, 10, 3, 3), 1.0)
        self.assertEqual(hypergeom_sf(4, 10, 3, 3), 0.0)

    def test_bh_adjust(self):
        values = [0.01, 0.04, 0.03, 0.20]
        adjusted = bh_adjust(values)
        self.assertEqual(len(adjusted), 4)
        self.assertAlmostEqual(adjusted[0], 0.04)
        self.assertAlmostEqual(adjusted[2], 0.05333333333333334)
        self.assertAlmostEqual(adjusted[3], 0.20)
        self.assertTrue(all(0 <= value <= 1 for value in adjusted))

    def test_jaccard(self):
        self.assertEqual(jaccard({"a", "b"}, {"b", "c"}), 1 / 3)
        self.assertIsNone(jaccard(set(), set()))

    def test_median(self):
        self.assertEqual(median([3, 1, 2]), 2)
        self.assertEqual(median([4, 1, 3, 2]), 2.5)


if __name__ == "__main__":
    unittest.main()

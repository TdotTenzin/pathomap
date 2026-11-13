"""Tests for external API request construction."""

from __future__ import annotations

import argparse
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import api_clients


class StringClientTests(unittest.TestCase):
    @patch("api_clients.http_json")
    def test_combined_network_uses_newline_separated_string_ids(self, http_json):
        http_json.return_value = []
        api_clients.fetch_string_network_for_ids(
            ["9606.ENSP00000000002", "9606.ENSP00000000001"],
            Path("cache"),
            argparse.Namespace(refresh=False, no_network=False),
        )

        url = http_json.call_args.args[0]
        self.assertIn(
            "identifiers=9606.ENSP00000000001%0D9606.ENSP00000000002",
            url,
        )
        self.assertNotIn("%2C", url)
        self.assertTrue(str(http_json.call_args.args[2]).startswith("cache"))


class KeggClientTests(unittest.TestCase):
    @patch("api_clients.http_text")
    def test_gene_pathway_cache_is_text_not_json(self, http_text):
        http_text.return_value = "hsa:123\tpath:hsa00010\n"
        links = api_clients.fetch_kegg_gene_pathways(
            "hsa:123",
            Path("cache"),
            argparse.Namespace(refresh=False, no_network=False),
        )

        self.assertEqual(links, [{"gene_id": "hsa:123", "pathway_id": "hsa00010"}])
        self.assertEqual(http_text.call_args.args[2], Path("cache") / "kegg" / "links" / "hsa-123.txt")


if __name__ == "__main__":
    unittest.main()

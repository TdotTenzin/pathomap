"""Tests for cached/retrying HTTP access and strict read-only mode."""

from __future__ import annotations

import argparse
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import http_client
from http_client import ApiError, http_json, http_text
from io_utils import no_writes, write_text


class _Response:
    def __init__(self, body: str) -> None:
        self._body = body.encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *exc) -> bool:
        return False


def _args(**overrides) -> argparse.Namespace:
    values = {"refresh": False, "no_network": False}
    values.update(overrides)
    return argparse.Namespace(**values)


class HttpClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.cache = Path(self._tmp.name) / "cache.json"
        self.url = "https://rest.uniprot.org/uniprotkb/P12345.json"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_cache_hit_avoids_network(self) -> None:
        write_text(self.cache, "cached text")
        with patch.object(http_client.urllib.request, "urlopen") as request:
            self.assertEqual(http_text(self.url, _args(), self.cache), "cached text")
        request.assert_not_called()

    def test_refresh_bypasses_cache_and_rewrites_it(self) -> None:
        write_text(self.cache, "old")
        with (
            patch.object(http_client.urllib.request, "urlopen", return_value=_Response("new")),
            patch.object(http_client, "_throttle"),
        ):
            self.assertEqual(http_text(self.url, _args(refresh=True), self.cache), "new")
        self.assertEqual(self.cache.read_text(encoding="utf-8"), "new")

    def test_no_network_without_cache_raises(self) -> None:
        with self.assertRaises(ApiError):
            http_text(self.url, _args(no_network=True), self.cache)

    def test_retry_succeeds_with_linear_backoff(self) -> None:
        failures = [urllib.error.URLError("temporary"), _Response("ok")]
        with (
            patch.object(http_client.urllib.request, "urlopen", side_effect=failures),
            patch.object(http_client, "_throttle"),
            patch.object(http_client.time, "sleep") as sleep,
        ):
            self.assertEqual(http_text(self.url, _args(), self.cache), "ok")
        sleep.assert_called_once_with(1.5)

    def test_retry_after_header_is_honoured(self) -> None:
        error = urllib.error.HTTPError(self.url, 429, "slow down", {"Retry-After": "2"}, None)
        with (
            patch.object(http_client.urllib.request, "urlopen", side_effect=[error, _Response("ok")]),
            patch.object(http_client, "_throttle"),
            patch.object(http_client.time, "sleep") as sleep,
        ):
            self.assertEqual(http_text(self.url, _args(), self.cache), "ok")
        sleep.assert_called_once_with(2.0)

    def test_no_sleep_after_final_attempt(self) -> None:
        errors = [urllib.error.HTTPError(self.url, 500, "bad", {}, None) for _ in range(3)]
        with (
            patch.object(http_client.urllib.request, "urlopen", side_effect=errors),
            patch.object(http_client, "_throttle"),
            patch.object(http_client.time, "sleep") as sleep,
        ):
            with self.assertRaises(ApiError):
                http_text(self.url, _args(), self.cache)
        self.assertEqual(sleep.call_count, 2)

    def test_check_mode_does_not_write_cache(self) -> None:
        with (
            no_writes(),
            patch.object(http_client.urllib.request, "urlopen", return_value=_Response("fresh")),
            patch.object(http_client, "_throttle"),
        ):
            self.assertEqual(http_text(self.url, _args(), self.cache), "fresh")
        self.assertFalse(self.cache.exists())

    def test_http_json_accepts_array_payload(self) -> None:
        write_text(self.cache, "[1, 2, 3]")
        self.assertEqual(http_json(self.url, _args(), self.cache), [1, 2, 3])


if __name__ == "__main__":
    unittest.main()

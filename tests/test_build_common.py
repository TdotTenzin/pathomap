"""Tests for the shared build helpers and strict read-only mode."""

from __future__ import annotations

import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_common import (
    begin_sqlite_write,
    no_writes,
    utc_now,
    validate_references,
    write_json,
    write_text,
    writes_enabled,
)
from identifiers import entity_id, is_entity_id, write_registry


class SharedHelperTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_write_json_is_atomic_and_leaves_no_temp_file(self) -> None:
        path = self.root / "nested" / "data.json"
        write_json(path, {"ok": True})
        self.assertEqual(path.read_text(encoding="utf-8"), '{\n  "ok": true\n}\n')
        self.assertEqual(list(path.parent.glob("*.tmp")), [])

    def test_write_json_rejects_nan(self) -> None:
        with self.assertRaises(ValueError):
            write_json(self.root / "nan.json", {"value": float("nan")})

    def test_no_writes_suppresses_json_text_registry_and_sqlite(self) -> None:
        json_path = self.root / "data.json"
        text_path = self.root / "schema.sql"
        registry_path = self.root / "ids.json"
        db_path = self.root / "db.sqlite"

        with no_writes():
            self.assertFalse(writes_enabled())
            write_json(json_path, {"a": 1})
            write_text(text_path, "CREATE TABLE x (id INTEGER);")
            write_registry(registry_path, "effectors", {"1|X": entity_id("effector", 1)}, "test")
            con, finalize = begin_sqlite_write(db_path)
            con.execute("CREATE TABLE x (id INTEGER)")
            finalize(con)

        for path in (json_path, text_path, registry_path, db_path):
            self.assertFalse(path.exists(), path)
        self.assertTrue(writes_enabled())

    def test_sqlite_write_swaps_file_and_preserves_existing_tables(self) -> None:
        db_path = self.root / "db.sqlite"
        con, finalize = begin_sqlite_write(db_path)
        con.execute("CREATE TABLE existing (id INTEGER)")
        finalize(con)
        self.assertTrue(db_path.exists())

        con, finalize = begin_sqlite_write(db_path, reuse_existing=True)
        con.execute("CREATE TABLE added (id INTEGER)")
        con.execute("INSERT INTO existing VALUES (1)")
        finalize(con)

        check = sqlite3.connect(db_path)
        try:
            tables = {row[0] for row in check.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertIn("existing", tables)
            self.assertIn("added", tables)
            self.assertEqual(check.execute("SELECT count(*) FROM existing").fetchone()[0], 1)
        finally:
            check.close()

    def test_sqlite_write_discards_temp_file_on_failure(self) -> None:
        db_path = self.root / "db.sqlite"
        with self.assertRaises(RuntimeError):
            con, finalize = begin_sqlite_write(db_path)
            try:
                con.execute("CREATE TABLE partial (id INTEGER)")
                raise RuntimeError("boom")
            finally:
                finalize(con)
        self.assertFalse(db_path.exists())
        self.assertEqual(list(self.root.glob("*.tmp")), [])

    def test_is_entity_id_rejects_unknown_type(self) -> None:
        self.assertFalse(is_entity_id(entity_id("effector", 1), "bogus"))
        self.assertTrue(is_entity_id(entity_id("effector", 1), "effector"))
        self.assertFalse(is_entity_id("not-an-id", "effector"))

    def test_utc_now_format(self) -> None:
        self.assertRegex(utc_now(), r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_validate_references_detects_duplicate_doi(self) -> None:
        references = [
            {"entity_id": entity_id("reference", 1), "doi": "10.1/a", "url": "https://doi.org/10.1/a"},
            {"entity_id": entity_id("reference", 2), "doi": "10.1/A", "url": "https://doi.org/10.1/wrong"},
        ]
        errors = validate_references([], references)
        self.assertTrue(any("duplicate DOI" in error for error in errors))
        self.assertTrue(any(re.search(r"url must", error) for error in errors))


if __name__ == "__main__":
    unittest.main()

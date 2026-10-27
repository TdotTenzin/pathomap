"""
Tests for the data loader module (SQLite helpers).
"""

import sqlite3

from pathomap.data.loader import (
    DB_PATH,
    close_connection,
    get_connection,
    query,
    to_df,
)


def test_db_path_exists():
    """The packaged database file should exist on disk."""
    assert DB_PATH.exists()


def test_query_select_count():
    """query() should return rows accessible by column name."""
    rows = query("SELECT COUNT(*) AS n FROM pathogens")
    assert len(rows) == 1
    assert rows[0]["n"] == 54


def test_query_with_params():
    """query() should honour bound parameters."""
    rows = query("SELECT name FROM pathogens WHERE strategy = ?", ("arrest",))
    assert len(rows) > 0
    for r in rows:
        assert "name" in dict(r)


def test_to_df_returns_dataframe():
    """to_df() should return a pandas DataFrame."""
    df = to_df("SELECT * FROM pathogens")
    assert not df.empty
    assert "name" in df.columns


def test_connection_reuse():
    """get_connection() should return the same thread-local connection."""
    con1 = get_connection()
    con2 = get_connection()
    assert con1 is con2
    assert isinstance(con1, sqlite3.Connection)
    close_connection()


def test_connection_row_factory():
    """Connections should use sqlite3.Row so columns are accessible by name."""
    con = get_connection()
    assert con.row_factory is sqlite3.Row
    close_connection()

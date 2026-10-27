"""
loader.py — SQLite connection and query helpers.

This is the public API for accessing the pathomap database.
All other modules import from here rather than using sqlite3 directly.

Uses thread-local connection pooling to avoid repeated open/close overhead.
"""

import pathlib
import sqlite3
import threading

import pandas as pd

# Path to the pre-built database (relative to this file)
DB_PATH = pathlib.Path(__file__).parent / "pathomap.db"

# Thread-local storage for connection pooling
_local = threading.local()


def get_connection() -> sqlite3.Connection:
    """
    Return a thread-local SQLite connection with row_factory set
    so rows can be accessed by column name (like a dict).

    Connections are reused within the same thread to avoid
    repeated open/close overhead.
    """
    con = getattr(_local, "connection", None)
    if con is not None:
        try:
            # Verify connection is still valid
            con.execute("SELECT 1")
            return con
        except sqlite3.ProgrammingError:
            # Connection was closed or is in a bad state
            _local.connection = None

    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    _local.connection = con
    return con


def close_connection():
    """Close the current thread's database connection if open."""
    con = getattr(_local, "connection", None)
    if con is not None:
        con.close()
        _local.connection = None


def query(sql: str, params: tuple | None = None) -> list[sqlite3.Row]:
    """
    Execute a SELECT query and return the result as a list of Row objects.
    Each Row can be accessed like r['column_name'].

    Example:
        rows = query("SELECT * FROM pathogens WHERE strategy = ?", ("arrest",))
        for r in rows:
            print(r["name"], r["gram_stain"])
    """
    con = get_connection()
    if params:
        return con.execute(sql, params).fetchall()
    return con.execute(sql).fetchall()


def to_df(sql: str, params: tuple | None = None) -> pd.DataFrame:
    """
    Execute a SELECT query and return the result as a pandas DataFrame.
    Column names come from the SQL SELECT clause.

    Example:
        >>> df = to_df('''
        ...     SELECT p.name AS pathogen, e.name AS effector
        ...     FROM effectors e
        ...     JOIN pathogens p ON e.pathogen_id = p.id
        ... ''')
        >>> print(df.head())
    """
    con = get_connection()
    return pd.read_sql_query(sql, con, params=params)

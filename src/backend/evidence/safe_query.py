"""Validation and provenance extraction for agent-written SQL.

`validate_sql` is the gatekeeper: it accepts exactly one plain SELECT that only
touches allow-listed tables, and returns the tables, columns and filters the
query actually uses (so evidence comes from the real query, not from what the
agent claims). It never touches a database. Database-level protections
(SELECT-only role, read-only transaction, statement_timeout, row cap) are
layered on top when the query is executed.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Dict, FrozenSet, Iterator, List, Mapping, Optional

import sqlglot
from sqlglot import exp
from sqlglot.errors import SqlglotError

DIALECT = "postgres"
DEFAULT_SCHEMA = "public"
MAX_SQL_LENGTH = 10_000

# schema -> tables the agent may read. Update when the seeded warehouse schema lands.
ALLOWED_TABLES: Mapping[str, FrozenSet[str]] = {
    "public": frozenset({"transactions"}),
}

# Statement types that must never appear anywhere in the query tree
# (this also catches data-modifying CTEs like WITH d AS (DELETE ...)).
_FORBIDDEN_NODE_NAMES = (
    "Insert", "Update", "Delete", "Merge", "Drop", "Create", "Alter", "Command",
    "Copy", "Set", "Into", "Lock", "TruncateTable", "Grant", "Revoke", "Use",
    "Transaction", "Commit", "Rollback",
)
_FORBIDDEN_NODES = tuple(
    getattr(exp, name) for name in _FORBIDDEN_NODE_NAMES if hasattr(exp, name)
)

# Functions that read files, sleep, call out, or touch settings.
_FORBIDDEN_FUNCTIONS = frozenset({
    "dblink", "dblink_exec", "lo_import", "lo_export", "lo_get", "set_config",
    "current_setting", "query_to_xml", "xmlparse", "txid_current",
})


class UnsafeQueryError(ValueError):
    """Raised when SQL is rejected. `code` is stable and safe to show to users."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ParsedQuery:
    sql: str
    tables: List[str] = field(default_factory=list)
    columns: List[str] = field(default_factory=list)
    filters: List[str] = field(default_factory=list)


def _ident_name(ident: Optional[exp.Expression]) -> Optional[str]:
    """Postgres folds unquoted identifiers to lower case; quoted ones keep case."""
    if ident is None or not getattr(ident, "name", ""):
        return None
    name = ident.name
    return name if ident.args.get("quoted") else name.lower()


def _conjuncts(node: exp.Expression) -> Iterator[exp.Expression]:
    if isinstance(node, exp.And):
        yield from _conjuncts(node.left)
        yield from _conjuncts(node.right)
    else:
        yield node


def _check_statement(sql: str) -> exp.Select:
    if not sql or not sql.strip():
        raise UnsafeQueryError("empty_query", "The query is empty.")
    if len(sql) > MAX_SQL_LENGTH:
        raise UnsafeQueryError("query_too_long", "The query is too long.")
    try:
        parsed = sqlglot.parse(sql, read=DIALECT)
    except SqlglotError as exc:
        raise UnsafeQueryError("parse_error", "The query could not be parsed.") from exc

    statements = [s for s in parsed if s is not None]
    if not statements:
        raise UnsafeQueryError("empty_query", "The query is empty.")
    if len(statements) > 1:
        raise UnsafeQueryError("multiple_statements", "Only one statement is allowed.")

    root = statements[0]
    if not isinstance(root, exp.Select):
        raise UnsafeQueryError("not_select", "Only SELECT queries are allowed.")

    for node in root.walk():
        if isinstance(node, _FORBIDDEN_NODES):
            raise UnsafeQueryError(
                "forbidden_construct",
                f"{type(node).__name__.upper()} is not allowed in a read-only query.",
            )
    for func in root.find_all(exp.Func):
        name = func.name if isinstance(func, exp.Anonymous) else func.sql_name()
        lowered = name.lower()
        if lowered.startswith("pg_") or lowered in _FORBIDDEN_FUNCTIONS:
            raise UnsafeQueryError(
                "forbidden_function", f"Function {name} is not allowed."
            )
    return root


def validate_sql(
    sql: str, allowed_tables: Optional[Mapping[str, FrozenSet[str]]] = None
) -> ParsedQuery:
    """Return what the query reads, or raise UnsafeQueryError."""
    allowed = allowed_tables if allowed_tables is not None else ALLOWED_TABLES
    root = _check_statement(sql)

    cte_names = {
        (cte.alias_or_name or "").lower() for cte in root.find_all(exp.CTE)
    }

    tables: List[str] = []
    alias_to_table: Dict[str, str] = {}
    for tbl in root.find_all(exp.Table):
        if not isinstance(tbl.this, exp.Identifier):
            raise UnsafeQueryError(
                "forbidden_construct", "Table-valued functions are not allowed."
            )
        if tbl.args.get("catalog"):
            raise UnsafeQueryError(
                "table_not_allowed", "Cross-database references are not allowed."
            )
        name = _ident_name(tbl.this)
        schema = _ident_name(tbl.args.get("db"))
        if schema is None and name in cte_names:
            continue  # reference to a WITH-clause name, not a real table
        resolved_schema = schema or DEFAULT_SCHEMA
        if name not in allowed.get(resolved_schema, frozenset()):
            raise UnsafeQueryError(
                "table_not_allowed",
                f"Table {resolved_schema}.{name} is not available to this tool.",
            )
        label = f"{schema}.{name}" if schema else name
        if label not in tables:
            tables.append(label)
        alias = (tbl.alias or name).lower()
        alias_to_table[alias] = name

    select_aliases = {
        e.alias.lower() for e in root.find_all(exp.Alias) if e.alias
    }
    only_table = next(iter(alias_to_table.values())) if len(set(alias_to_table.values())) == 1 else None

    columns: List[str] = []

    def add_column(label: str) -> None:
        if label not in columns:
            columns.append(label)

    for col in root.find_all(exp.Column):
        qualifier = (col.table or "").lower()
        if isinstance(col.this, exp.Star):
            col_name = "*"
        else:
            col_name = _ident_name(col.this) or ""
        if not col_name:
            continue
        if qualifier:
            table = alias_to_table.get(qualifier)
            if table is None:
                continue  # qualifier is a CTE/subquery alias
            add_column(f"{table}.{col_name}")
        elif col_name in select_aliases:
            continue  # refers to an output alias, not a real column
        elif only_table:
            add_column(f"{only_table}.{col_name}")
        else:
            add_column(col_name)
    for star in root.find_all(exp.Star):
        if isinstance(star.parent, exp.Column):
            continue
        if isinstance(star.parent, exp.Count):
            continue
        add_column(f"{only_table}.*" if only_table else "*")

    filters: List[str] = []
    for where in root.find_all(exp.Where):
        for cond in _conjuncts(where.this):
            text = cond.sql(dialect=DIALECT)
            if text not in filters:
                filters.append(text)

    return ParsedQuery(sql=sql.strip(), tables=tables, columns=columns, filters=filters)


def to_cell(value: Any) -> Any:
    """Make a database value JSON-safe without losing precision.
    Decimals (money) become exact strings, never floats."""
    if value is None or isinstance(value, (str, bool)):
        return value if not isinstance(value, bool) else str(value).lower()
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, int):
        return value
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, float):
        return repr(value)
    return str(value)
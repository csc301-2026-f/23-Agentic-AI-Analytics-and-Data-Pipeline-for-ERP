from decimal import Decimal
from datetime import date

import pytest

from evidence.safe_query import UnsafeQueryError, to_cell, validate_sql

CASH_FLOW = (
    "SELECT date_trunc('month', txn_date) AS month, "
    "SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS inflows "
    "FROM transactions "
    "WHERE txn_date >= '2026-01-01' AND txn_date < '2026-04-01' "
    "GROUP BY 1 ORDER BY month"
)


def code_of(sql: str) -> str:
    with pytest.raises(UnsafeQueryError) as exc:
        validate_sql(sql)
    return exc.value.code


# ---- accepted queries -------------------------------------------------------
def test_accepts_cash_flow_query_and_extracts_provenance():
    parsed = validate_sql(CASH_FLOW)
    assert parsed.tables == ["transactions"]
    assert parsed.columns == ["transactions.txn_date", "transactions.amount"]
    assert parsed.filters == [
        "txn_date >= '2026-01-01'",
        "txn_date < '2026-04-01'",
    ]


def test_trailing_semicolon_is_fine():
    assert validate_sql("SELECT amount FROM transactions;").tables == ["transactions"]


def test_schema_qualified_table_is_accepted():
    parsed = validate_sql("SELECT amount FROM public.transactions")
    assert parsed.tables == ["public.transactions"]


def test_alias_and_qualified_columns_resolve_to_table():
    parsed = validate_sql("SELECT t.amount FROM transactions t WHERE t.amount > 0")
    assert parsed.columns == ["transactions.amount"]
    assert parsed.filters == ["t.amount > 0"]


def test_select_star_is_reported():
    assert validate_sql("SELECT * FROM transactions").columns == ["transactions.*"]


def test_count_star_is_not_reported_as_a_column():
    assert validate_sql("SELECT COUNT(*) FROM transactions").columns == []


def test_cte_over_allowed_table_is_accepted():
    parsed = validate_sql(
        "WITH m AS (SELECT amount FROM transactions) SELECT SUM(amount) FROM m"
    )
    assert parsed.tables == ["transactions"]


def test_output_alias_is_not_reported_as_a_column():
    parsed = validate_sql(
        "SELECT SUM(amount) AS total FROM transactions GROUP BY txn_date ORDER BY total"
    )
    assert "transactions.total" not in parsed.columns
    assert "total" not in parsed.columns


# ---- rejected: not a single plain SELECT ------------------------------------
@pytest.mark.parametrize(
    "sql, code",
    [
        ("", "empty_query"),
        ("   ", "empty_query"),
        ("SELECT 1 FROM transactions; SELECT 2 FROM transactions", "multiple_statements"),
        ("SELECT amount FROM transactions; DROP TABLE transactions", "multiple_statements"),
        ("DROP TABLE transactions", "not_select"),
        ("INSERT INTO transactions (amount) VALUES (1)", "not_select"),
        ("UPDATE transactions SET amount = 0", "not_select"),
        ("DELETE FROM transactions", "not_select"),
        ("TRUNCATE transactions", "not_select"),
        ("COPY transactions TO '/tmp/x'", "not_select"),
        ("SET statement_timeout = 0", "not_select"),
        ("EXPLAIN ANALYZE SELECT 1", "not_select"),
        ("SELECT 1 UNION SELECT 2", "not_select"),
    ],
)
def test_rejects_non_select_and_multi_statement(sql, code):
    assert code_of(sql) == code


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * INTO backup FROM transactions",
        "SELECT * FROM transactions FOR UPDATE",
        "WITH d AS (DELETE FROM transactions RETURNING *) SELECT * FROM d",
    ],
)
def test_rejects_hidden_writes_and_locks(sql):
    assert code_of(sql) == "forbidden_construct"


# ---- rejected: tables and schemas outside the allowlist ---------------------
@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM users",
        "SELECT * FROM pg_catalog.pg_user",
        "SELECT * FROM information_schema.tables",
        "SELECT * FROM other_schema.transactions",
        "SELECT * FROM transactions JOIN users ON true",
        'SELECT * FROM "Transactions"',  # different table in Postgres (quoted case)
        "SELECT * FROM transactions WHERE amount IN (SELECT amount FROM users)",
    ],
)
def test_rejects_tables_outside_allowlist(sql):
    assert code_of(sql) == "table_not_allowed"


def test_rejects_cross_database_reference():
    assert code_of("SELECT * FROM otherdb.public.transactions") == "table_not_allowed"


def test_rejects_table_valued_functions():
    assert code_of("SELECT * FROM generate_series(1, 1000000)") == "forbidden_construct"


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT pg_sleep(30)",
        "SELECT pg_read_file('/etc/passwd')",
        "SELECT set_config('statement_timeout', '0', false)",
        "SELECT current_setting('server_version')",
    ],
)
def test_rejects_dangerous_functions(sql):
    assert code_of(sql) == "forbidden_function"


def test_custom_allowlist_is_respected():
    allowed = {"warehouse": frozenset({"cash_txn"})}
    assert validate_sql("SELECT x FROM warehouse.cash_txn", allowed).tables == [
        "warehouse.cash_txn"
    ]
    with pytest.raises(UnsafeQueryError):
        validate_sql("SELECT x FROM transactions", allowed)


def test_garbage_is_a_clean_rejection_not_a_crash():
    with pytest.raises(UnsafeQueryError):
        validate_sql("SELEC FROM WHERE ((")


def test_overlong_query_is_rejected():
    assert code_of("SELECT amount FROM transactions WHERE " + "1=1 AND " * 3000 + "1=1") == "query_too_long"


# ---- money / value serialization -------------------------------------------
def test_decimals_become_exact_strings():
    assert to_cell(Decimal("12000.00")) == "12000.00"
    assert to_cell(Decimal("-4500.10")) == "-4500.10"
    assert to_cell(Decimal("1E+3")) == "1000"


def test_dates_none_and_ints():
    assert to_cell(date(2026, 1, 3)) == "2026-01-03"
    assert to_cell(None) is None
    assert to_cell(7) == 7

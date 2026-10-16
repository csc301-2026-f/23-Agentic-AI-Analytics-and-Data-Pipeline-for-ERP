-- 003: query evidence shown to reviewers (SQL, tables, columns, filters, supporting rows).
-- Lives in the `app` schema, which the read-only safe-query role cannot access.
-- Evidence is stored as one JSON object matching the shared Evidence type.

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.evidence (
    evidence_id TEXT PRIMARY KEY CHECK (length(evidence_id) BETWEEN 1 AND 200),
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (payload ->> 'evidenceId' = evidence_id)
);

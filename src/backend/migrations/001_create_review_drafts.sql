CREATE TABLE IF NOT EXISTS review_drafts (
    draft_id UUID NOT NULL,
    conversation_id TEXT NOT NULL CHECK (length(conversation_id) BETWEEN 1 AND 200),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    report_payload JSONB NOT NULL CHECK (jsonb_typeof(report_payload) = 'object'),
    evidence_id TEXT NOT NULL CHECK (length(evidence_id) BETWEEN 1 AND 200),
    rejection_feedback TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    PRIMARY KEY (draft_id, revision),
    CHECK (
        (status = 'pending' AND rejection_feedback IS NULL AND reviewed_at IS NULL)
        OR (status = 'approved' AND rejection_feedback IS NULL AND reviewed_at IS NOT NULL)
        OR (
            status = 'rejected'
            AND rejection_feedback IS NOT NULL
            AND length(rejection_feedback) BETWEEN 1 AND 4000
            AND reviewed_at IS NOT NULL
        )
    )
);

CREATE INDEX IF NOT EXISTS review_drafts_conversation_revision_idx
    ON review_drafts (conversation_id, revision DESC);

CREATE INDEX IF NOT EXISTS review_drafts_status_updated_idx
    ON review_drafts (status, updated_at DESC);

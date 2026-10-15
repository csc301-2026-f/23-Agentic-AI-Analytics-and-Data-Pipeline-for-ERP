-- Harness state only. Apply explicitly to an authorized local/demo database.
-- 000/002/003 remain team-owned; this does not create warehouse or evidence data.
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.agent_runs (
    run_id UUID PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    request_id UUID NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'running', 'interrupted', 'clarification_needed', 'pending_review', 'failed'
    )),
    body JSONB NOT NULL CHECK (jsonb_typeof(body) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, request_id)
);
CREATE INDEX IF NOT EXISTS agent_runs_conversation_idx
    ON app.agent_runs (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app.agent_steps (
    step_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES app.agent_runs(run_id),
    phase TEXT NOT NULL CHECK (phase IN (
        'interpret', 'plan', 'discover', 'execute', 'observe', 'decide', 'checkpoint', 'recover'
    )),
    event JSONB NOT NULL CHECK (jsonb_typeof(event) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce append-only history even when the application role can update runs.
CREATE OR REPLACE FUNCTION app.protect_agent_steps() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'agent_steps is append-only';
END;
$$;
DROP TRIGGER IF EXISTS agent_steps_immutable ON app.agent_steps;
CREATE TRIGGER agent_steps_immutable BEFORE UPDATE OR DELETE ON app.agent_steps
    FOR EACH ROW EXECUTE FUNCTION app.protect_agent_steps();

-- Written in the SAME transaction as Ethan's draft insert.
-- No FK to review_drafts: its schema placement is still a team-owned decision.
CREATE TABLE IF NOT EXISTS app.agent_submissions (
    submission_key UUID PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    draft JSONB NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

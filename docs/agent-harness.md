# Persistent cash-flow agent harness

## Implemented boundary

The Python harness owns model/tool orchestration, checkpoints, safe progress and
outcomes, and submission to the existing review service. OpenAI Responses is the
first provider. It uses schema-constrained function calls with parallel calls
disabled. Model ID and API credentials must be supplied explicitly.

Discovery and financial reporting remain teammate-owned services. Production
wiring returns `service_unavailable` until real implementations are supplied.
The test doubles and financial fixtures are confined to `src/backend/tests`.
The existing `/api/chat` still serves the original scaffold: this change does
not replace Yujin's conversation API or connect it to the browser.

The integrated two-tab, live-model demonstration is **not yet verified**. It
requires the real discovery/query/report/evidence implementations, credentials,
and the conversation/frontend handoff described below. PostgreSQL integration
tests exercise real storage, arithmetic queries, restricted roles and review
transactions with a scripted model and test-only financial adapters.

## Runtime

The nominal cycle is interpret, plan, discover, execute, observe, decide. The
provider chooses one typed action per decision. It can discover datasets,
inspect their metadata, request an advertised cash-flow metric, ask a question,
finish using a trusted artifact reference, or stop. The application enforces
discovery/inspection prerequisites, permitted datasets, metadata versions,
published metric IDs and the interpreted period/currency.

The tool request never contains SQL or report amounts. Reporting services own
SQL construction and exact calculations; they must use Gandi's restricted query
executor and persist real evidence. A reporting artifact must be bound to the
conversation and the exact calculation request. Floats and embedded SQL/evidence
are rejected using the existing review payload validator. Report payload remains
the existing provisional JSON envelope until Marshal supplies the final schema.

Defaults are 12 model decisions, 12 external tool calls, two replans and 120
seconds of active execution. Interpret/plan/clarify decisions count against the
model budget; discovery/inspection/calculation/completion count against the tool
budget. A `COLUMN_NOT_FOUND` or `STALE_METADATA` observation clears cached
inspection/results and forces a new plan/discovery. `QUERY_TIMEOUT` can trigger
one such retry. Policy denials stop immediately. No credentials are retried or
swapped. A synchronous adapter must not perform unbounded blocking IO: use
bounded asynchronous IO or an executor with independent DB timeouts.

Missing year/period or currency prompts clarification. The model is instructed
to preserve supplied facts and never invent missing details. Only monthly cash
flow is supported, one currency per report, without conversion. An empty result
asks for period confirmation/change; a confirmed period that is still empty
returns `missing_data`. An unknown metric fails without generating a report.

Questions, progress and failure messages are server-owned templates. Arbitrary
model prose, exception text, SQL, report values, evidence IDs, supporting rows
and reviewer-only information are never forwarded in these outcomes. Provider
context includes bounded source identifiers/schema fields, published metric IDs,
request context and internal reviewer feedback. Treat all these text inputs as
untrusted; the model cannot grant permissions or change registered tools.

## Calling from the conversation service

The canonical entry point is:

```python
from uuid import uuid4
from src.backend.agent.models import AgentRequest

async def on_progress(text: str):
    # Yujin's adapter wraps this constant safe text in an SSE progress event.
    ...

outcome = await app.state.agent_harness.run_turn(
    AgentRequest(
        conversation_id=conversation_id,
        request_id=uuid4(),
        message=user_message,
        context=business_safe_history,
    ),
    progress=on_progress,
)
```

These are internal Python contracts with snake_case fields. Yujin's adapter owns
camelCase serialization, conversation/message IDs, exactly one SSE `done` event,
history storage and review-status polling. Do not persist `progress` as reasoning
or send internal checkpoints to the browser. `context` is up to 20 business-safe
messages, each up to 8,000 characters; evidence/SQL/provider history must not be
passed through this field.

Outcome types:

| Status | Fields in addition to `conversation_id`, `run_id` |
| --- | --- |
| `clarification_needed` | `clarification.field`, fixed `question`, optional `options` |
| `pending_review` | `draft_id` (UUID), `revision`, fixed `response` |
| `failed` | `error.code`, fixed `error.message`, `error.retryable` |

Failure codes are `missing_data`, `query_rejected`, `service_unavailable`,
`execution_limit`, `invalid_request`, and `conversation_busy`. The last two
cover stale/idempotency/continuation conflicts and concurrent turns; the chat
adapter must preserve them or deliberately map them to its public error contract.

- Generate a new `request_id` for each user turn; reuse it only when retrying the
  exact same transport request. Identical completed requests replay their stored
  outcome, while changed content under the same ID is rejected.
- A normal message following `clarification_needed` resumes that request and
  its resolved slots automatically. "New analysis" must use a new conversation ID.
- **Only after a user asks to revise**, pass `action="revise"` and optionally
  `revision_target=<draft UUID>`. The harness loads the original request/slots and
  stored rejection feedback. It never trusts feedback supplied by the browser.
  More than one rejected candidate requires explicit target selection by the
  conversation UI. Unknown/unowned/non-rejected targets cannot be revised.
- After an interrupted run, pass a new request ID with `action="resume"` and
  `resume_run_id=<run UUID>`. Only the latest interrupted run in that conversation
  can resume. A failed analysis can be retried as a fresh request, supplying the
  original request/context; do not silently resume on an HTTP transport retry.
- Revision submission keeps the draft ID, checks the expected latest rejected
  revision under the existing review lock, and creates a new pending revision.
  Every revision requires new approval. Rejection alone never starts an agent.

## Persistence and submission guarantees

`app.agent_runs` stores typed run/checkpoint state and terminal outcomes.
`app.agent_steps` records append-only step events. Each checkpoint update and
its audit event commit in one transaction. The persisted information includes
the original request and bounded context, slots, plan versions, attempts,
budgets, safe observations, tool identities/inputs, artifact references and
revision target/feedback. It excludes provider secrets, hidden reasoning and
unrestricted query results. Treat these internal tables as private application
state: do not expose them through business-user endpoints.

A session advisory lock enforces one active attempt per conversation. A second
process-wide advisory lock prevents two harness workers from performing startup
recovery concurrently. Use a direct PostgreSQL connection or session pooling;
transaction pooling is incompatible with these session advisory locks.
Run **one API worker**. Startup marks abandoned running
records interrupted; it does not launch background analysis. A completed
calculation's durable artifact reference is reused after a process restart.
An operation interrupted before its observation was committed may run again;
read operations are safe to repeat, and reporting services must deduplicate the
provided call ID when they persist artifacts.

The review adapter calls `ReviewService` through a repository borrowing the
same database connection. It commits the draft/revision and its
`app.agent_submissions` idempotency receipt in one transaction. The key is saved
before any submission, survives continuation, and cannot be reused with changed
content. Existing review routes retain their current behavior.

A submission with an uncertain response is marked interrupted. Before accepting
another report in that conversation, the user must explicitly resume it. Resume
replays only the already-chosen submission with the same key; it does not rerun
the model or calculation. This bounded reconciliation has a separate 15-second
deadline so a committed write can be acknowledged even after the analysis budget
was exhausted. A second interruption remains resumable. It never creates a
second report for that key.

## Service handoffs

Implement the async protocols in `src/backend/agent/contracts.py` and return
`(discovery_gateway, reporting_gateway)` from a trusted Python factory. Configure
that factory as `AGENT_SERVICE_FACTORY=your.package:build_services`. This is
server configuration; model and request content cannot select/import code.

| Owner | Required behavior |
| --- | --- |
| Addison | `discover()` returns bounded, permitted `Dataset` IDs. `inspect(dataset)` returns `Metadata` with a version, fields, supported currencies, and published metric-definition IDs. Never advertise a source that cannot be queried. |
| Gandi / Marshal | `calculate(conversation_id, CalculationRequest, call_id)` constructs governed SQL from a published mapping, executes with restricted credentials/timeouts, computes exact monthly values, persists evidence/report artifacts, and returns `CalculationResult(empty, artifact_ref)`. Do not calculate from a truncated row sample. |
| Marshal | `load(artifact_ref)` returns the immutable `ReportArtifact` after validating current caller permissions; preserve its conversation ID, exact calculation request, decimal-string report payload and real evidence ID. Persist artifacts across process restarts. |
| Ethan | The included gateway supplies atomic/idempotent submission using the existing service. Coordinate the current unqualified `review_drafts` table/search path before moving it into `app`. The business-safe status API still needs the agreed rejection-feedback projection. |
| Yujin / Chengrui | Persist user-facing history, translate outcomes/progress, route explicit revisions and retries, provide target selection, and wire the browser to the real harness. |

Gateway failures use `ToolError(code)`. Supported codes include
`COLUMN_NOT_FOUND`, `STALE_METADATA`, `QUERY_TIMEOUT`, `PERMISSION_DENIED`,
`QUERY_REJECTED`, `MISSING_DATA`, and `SERVICE_UNAVAILABLE`. Unexpected exceptions
fail closed with a generic public message; their text is not stored in traces.
Adapters must independently enforce permission checks and metadata freshness on
every execution. Discovery is not an authorization grant.

## Setup and verification

Use Python 3.11 or newer and install `requirements-dev.txt`. Apply migration 001
and `004_create_agent_runtime.sql` explicitly to an authorized local/demo database.
Do not run these against shared Supabase without the team's migration procedure.
Migration 004 creates only harness state; it does not implement migrations
000/002/003 or grant a warehouse reader access to application data.

Set backend environment variables (names are in `.env.example`):

```dotenv
AGENT_HARNESS_ENABLED=1
GENLEDGE_DEMO_MODE=1
DATABASE_URL=<application PostgreSQL connection>
REVIEWER_DEMO_SECRET=<local reviewer secret>
OPENAI_API_KEY=<backend API key>
AGENT_MODEL=<tool-capable OpenAI model ID>
AGENT_SERVICE_FACTORY=your.package:build_services
```

Start locally, loading your private `.env` explicitly:

```sh
python -m uvicorn src.backend.app:app --env-file .env --host 127.0.0.1 --workers 1
```

Enabling the harness requires valid model configuration and migrated storage.
Missing configuration/storage fails startup; no key or credentials are printed.
Leaving the service factory unset intentionally keeps financial tools unavailable.
The optional loopback-only diagnostic `POST /api/agent/turn` accepts the internal
`AgentRequest` JSON and returns an outcome. It requires `GENLEDGE_DEMO_MODE=1`,
is disabled in production, and is not the streaming conversation API.

Run backend tests from the repository root:

```sh
PYTHONPATH=.:src/backend python -m pytest src/backend/tests -q
```

Optional disposable PostgreSQL tests require `pgserver` in the development
environment (`python -m pip install pgserver`). They create their own local
cluster, databases and test-only read roles and never read `DATABASE_URL`.
Without that optional package the PostgreSQL module is explicitly skipped.
`pgserver` is not a runtime dependency. Provider tests use `httpx.MockTransport`
and spend no API credits.

Before declaring the integrated MVP complete, run the real model against the
team's seeded database and verify both browser paths: request, clarification,
pending draft, evidence inspection, rejection, user-requested revision, fresh
approval and approved-only display. Repeat across refresh/restart and demonstrate
one stale-metadata replan. Do not use the existing fixed-sample `/demo` flow or
the scripted integration model as evidence of that acceptance.

# Review draft migration

`001_create_review_drafts.sql` creates the analytics review store. It is
separate from warehouse tables. The application does not run migrations
automatically; apply the SQL once against the configured PostgreSQL database:

```powershell
$env:DATABASE_URL = "postgresql://<user>:<password>@<host>:5432/<database>"
$env:REVIEWER_DEMO_SECRET = "<long-random-local-demo-secret>"
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f .\src\backend\migrations\001_create_review_drafts.sql
```

Use real values in the process environment only; do not commit credentials.
The root `.env.example` lists variable names but is not loaded automatically.
Install backend dependencies from the repository root with
`python -m pip install -r requirements.txt`; run the API with
`python -m uvicorn src.backend.app:app --reload`.

The table stores one row per draft revision. `draft_id` groups revisions and
`revision` identifies each immutable report version. API reads use only the
highest revision. Approving or rejecting locks that revision and permits only
the `pending` to decision transition. A new revision is inserted as `pending`,
so an older approval cannot authorize newer content. A transaction-scoped
PostgreSQL advisory lock serializes revision creation and decisions for the
same draft ID.

## Provisional report payload

`reportPayload` is currently an open JSON object because Marshal's final report
contract is not present in this repository. Treat it as a temporary integration
envelope and adapt its contents with Marshal before that service is connected.
JSON numbers may be integers, but floating-point numbers are rejected; financial
amounts must be decimal strings such as `"12000.00"`. The payload also rejects
`sql`, `supportingRows`, `evidence`, and `evidenceId` keys at any nesting level.
The draft stores only the `evidenceId` reference.

## Local two-screen review demonstration

The demo launcher reads only `DATABASE_URL` and `REVIEWER_DEMO_SECRET` from the
repository-root `.env` without printing either value. It enables demo mode for
that local process, starts both services on `127.0.0.1`, and keeps the reviewer
secret in the Next.js server process. Do not expose the development server to a
LAN or deploy this shared-secret gate to production. The localhost boundary is
a development convenience, not reviewer login or production authentication.

From the repository root, start the demo with:

```powershell
.\src\start-dev.ps1
```

The script does not apply migrations. Apply the migration above only to a
database you are authorized to modify. Do not run it against the shared Supabase
database without the team's explicit migration procedure and approval. If the
review table is missing, the API reports storage unavailable until the schema
has been provisioned.

Open `http://127.0.0.1:3000/demo` as the business user and
`http://127.0.0.1:3000/review` as the reviewer. The sample submission is a
fixed demo substitute, not an Agent Harness integration. Rejected feedback is
retained; creating a revised sample does not claim automatic regeneration.
If an API is already listening on port 8000, stop it first unless it uses this
root `.env` and the local demo flags; the launcher reuses a healthy API process.

## Routes

- `POST /api/review/drafts` — create a pending draft. Requires the reviewer
  demo gate for this standalone phase; trusted backend-to-backend integration
  should own this operation later.
- `GET /api/review/drafts` — list the latest revision of each draft.
- `GET /api/review/drafts/history` — list all stored revisions and decisions.
- `GET /api/review/drafts/{draft_id}` — retrieve the latest reviewer draft.
- `POST /api/review/drafts/{draft_id}/revisions` — create a new pending
  revision, retaining the conversation and draft IDs.
- `POST /api/review/drafts/{draft_id}/approve` — approve the pending revision.
  Requires `{"expectedRevision": 1}` for the revision currently displayed by the
  reviewer.
- `POST /api/review/drafts/{draft_id}/reject` — reject it with required
  `expectedRevision` and `feedback` fields.
- `GET /api/reports/{draft_id}/approved` — unauthenticated business-user view
  of report payload only, and only when the latest revision is approved.
- `GET /api/reports/{draft_id}/status` — business-safe status projection without
  report payload, evidence ID, or reviewer feedback.
- `POST /api/demo/reports` — localhost-only fixed sample submission, returning
  status metadata only. Requires `GENLEDGE_DEMO_MODE=1` and is disabled in
  production.
- `POST /api/demo/reports/{draft_id}/revisions` — localhost-only fixed revised
  sample submission, returning status metadata only.

The repository compares `expectedRevision` to the latest revision after taking
the per-draft transaction lock. Stale expected revisions and repeated/invalid
decisions return `409 Conflict`; absent request fields return `422
Unprocessable Entity`; absent drafts return `404 Not Found`;
unavailable/unconfigured storage returns `503 Service Unavailable`. The
reviewer routes require `X-Reviewer-Secret`. This is a local demo gate, not
production authentication.

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

## Routes

- `POST /api/review/drafts` — create a pending draft. Requires the reviewer
  demo gate for this standalone phase; trusted backend-to-backend integration
  should own this operation later.
- `GET /api/review/drafts` — list the latest revision of each draft.
- `GET /api/review/drafts/{draft_id}` — retrieve the latest reviewer draft.
- `POST /api/review/drafts/{draft_id}/revisions` — create a new pending
  revision, retaining the conversation and draft IDs.
- `POST /api/review/drafts/{draft_id}/approve` — approve the pending revision.
- `POST /api/review/drafts/{draft_id}/reject` — reject it with a required
  `feedback` string.
- `GET /api/reports/{draft_id}/approved` — unauthenticated business-user view
  of report payload only, and only when the latest revision is approved.

Invalid or repeated decisions return `409 Conflict`; absent drafts return
`404 Not Found`; unavailable/unconfigured storage returns `503 Service
Unavailable`. The reviewer routes require `X-Reviewer-Secret`. This is a local
demo gate, not production authentication.

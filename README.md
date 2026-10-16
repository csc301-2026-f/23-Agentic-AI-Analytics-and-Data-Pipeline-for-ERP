# GenLedge Agentic Analytics

CSC301 team project for GenLedge's agentic analytics capability. The goal is to let business users request reports in plain language and have an analytics agent identify relevant warehouse data, ask clarifying questions when needed, and produce traceable reports for review.

[Run the two-screen report review demo (MOCK mode)](#run-the-two-screen-report-review-demo-mock-mode)

## Deliverable 1

- Planning document: [`deliverables/D1/planning.md`](deliverables/D1/planning.md)
- Mockup links: [`deliverables/D1/mockup.md`](deliverables/D1/mockup.md)
- Interactive Figma prototype: [GenLedge Analytics Assistant](https://www.figma.com/design/RWN3CkOw0lzZCn4DFbcEUX/GenLedge-%25C2%25B7-Analytics-Assistant-%25E2%2580%2594-Interactive-Prototype?node-id=17-25446&p=f&t=Agtdm9Uu8ONuWML3-0)
- Prototype walkthrough: [Loom video](https://www.loom.com/share/2170564552cb445695b7ad81222e5a31)
- Team information: [`deliverables/team/`](deliverables/team/)

## Project status

This repository contains the Deliverable 1 planning materials and an active Deliverable 2 implementation using Next.js/React/TypeScript and FastAPI. Current components include reusable chart rendering, PostgreSQL-backed draft review/approval services, revision and feedback handling, a safe SQL validator and typed evidence contracts, and local two-screen report-review demo interfaces at `/demo` (business) and `/review` (reviewer).

The demo **mock** workflow has been exercised end to end. The **real PostgreSQL-backed browser workflow** has not yet been verified across both screens. The current demo uses fixed sample reports rather than Agent Harness output. The shared Supabase connection has been verified; schema migrations on the shared database remain coordinated team work. SQL execution against live warehouse data, evidence persistence/retrieval, automated reviewer-feedback-to-agent handoff, dynamic source/tool discovery and durable agent checkpoints remain integration or target-state tasks.

The localhost reviewer boundary uses a shared demo secret and does **not** provide production authentication. Never expose it to the LAN or a public deployment.

## Task management and communication

- Task tracking: Jira once GenLedge access is available; [Linear](https://linear.app/csc301-team/team/CSC/active) is being used temporarily for Deliverable 1 tasks.
- Partner communication: WhatsApp with GenLedge contacts Kulwant Yadav and Sapna Singhal.
- Internal communication: Discord for team coordination and PR review requests.
- Meeting minutes: [`deliverables/team/minutes/`](deliverables/team/minutes/)

## Development setup

The frontend uses Next.js, React, TypeScript, and Recharts for reusable analytics charts. The API uses FastAPI. Use Node.js 20.9 or newer and Python.

### Start both services on Windows

For the persistent D2 report-review demo, define `DATABASE_URL` and
`REVIEWER_DEMO_SECRET` in the root `.env` and run the local launcher. It loads
those values into the backend and frontend server processes without displaying
them, enables the localhost-only review demo, and binds both servers to
`localhost`:

```powershell
Set-Location src\frontend
npm install
Set-Location ..\..
.\src\start-dev.ps1
```

Keep both service windows open. Open `http://localhost:3000/demo` for the
business user and `http://localhost:3000/review` for the reviewer. The demo
submits a fixed sample in place of Agent Harness output. The shared-secret
reviewer gate is a localhost development convenience, not production
authentication. Do not expose the development server to a LAN. If another API
is already listening on port 8000, stop it first unless it was started with
this root `.env` and the demo flags; the launcher reuses a healthy API process.

The launcher does not apply database migrations. The review table must already
exist in the selected PostgreSQL database. Review
[`src/backend/migrations/README.md`](src/backend/migrations/README.md) for the
local migration and route details; do not apply a migration to shared Supabase
without the team's approved procedure.

### Start services manually

Install backend dependencies and start the API from the repository root:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn src.backend.app:app --reload
```

In a second terminal, start the frontend:

```powershell
Set-Location src\frontend
npm install
npm run dev
```

The frontend sends chat messages to `POST /api/chat`, which currently returns a randomly selected response. Next.js rewrites `/api` requests to `http://127.0.0.1:8000` by default. To use a different API origin during development, set `BACKEND_URL` to that origin before starting Next.js. The backend health endpoint is `GET /api/health`.

Ask the assistant to "make me a line graph", "generate me a bar graph", or "generate me a pie chart" to receive a sample chart response from the local FastAPI backend (no third-party AI service is used). The backend returns random revenue data, and the Next.js chat passes the structured chart spec to the reusable React `ChartRenderer` to display it. Other messages still receive the scaffold's sample text response.

### Rendering charts in React

Reusable `LineGraph`, `BarGraph`, and `PieGraph` components and the AI-spec-friendly `ChartRenderer` are exported from `src/frontend/src/components/charts`. They accept data and display options as props; chart specs are data, not executable AI-generated code.

```tsx
import { ChartRenderer, type AnalyticsChartSpec } from './components/charts'

const chart: AnalyticsChartSpec = {
  type: 'line',
  title: 'Revenue by year',
  xAxisName: 'Year',
  yAxisName: 'Revenue ($k)',
  seriesNames: ['Actual', 'Forecast'],
  data: [
    [[2024, 120], [2025, 145], [2026, 160]],
    [[2024, 110], [2025, 150], [2026, 180]],
  ],
  colors: ['#078b81', '#4776c5'],
}

export function RevenueChart() {
  return <ChartRenderer spec={chart} />
}
```

Line series are arrays of `[x, y]` points. Bar chart data can be `[category, value]` tuples or objects keyed by category and series. Pie chart data is an array of `{ label, value, color? }` slices. Each component exposes options for titles, axis labels, colors, legends, tooltips, grids, size, and chart-specific styling.

### Deploy the frontend to Vercel

Create a Vercel project from this repository and set its **Root Directory** to `src/frontend`. Vercel will detect Next.js and use the frontend's `npm run build` script. Set the `BACKEND_URL` environment variable for the deployment to the publicly reachable origin of the separately hosted FastAPI backend (for example, `https://api.example.com`), then deploy. Vercel hosts the Next.js frontend; the FastAPI backend must be hosted separately and reachable from Vercel.

## Architecture and dependencies

- **Current application:** Next.js/React/TypeScript frontend and FastAPI Python backend.

- **Database:** PostgreSQL for D2 warehouse and application state; shared Supabase dev connection verified, shared migrations coordinated.

- **Validation:** sqlglot-based read-only query validation is implemented; safely restricted PostgreSQL query execution and evidence persistence are pending.

- **Reporting UI:** Recharts/structured chart components; demo /demo and /review interfaces using fixed samples.

- **Agent Harness:** proposed bounded plan–discover–execute–observe–decide architecture; dynamic registry/checkpoints not yet proven end to end.

- **Data sources:** PostgreSQL now; CSV/Excel intended as ad-hoc D2 sources; SAP/QuickBooks sandbox exploration does not mean connectors are live.

For target-state design, tradeoffs and acceptance tests, see the REP02-22 architecture decision record.

## Run the two-screen report-definition demo (MOCK mode)

The D2 demo runs entirely through the Next.js frontend with browser-local mock
state. It does not start FastAPI, connect to PostgreSQL/Supabase, run migrations,
discover a live warehouse schema, call the Agent Harness, or execute SQL.

From the repository root, run:

```powershell
Set-Location src\frontend
npm install
$env:REVIEW_DEMO_MODE = 'mock'
npm run dev
```

Open two browser windows:

- Business user:   `http://localhost:3000/demo`
- Data engineer:   `http://localhost:3000/review`

Both pages display **MOCK · browser-local data**.

The business user submits a request for a reusable mapping definition. The data
engineer reviews the source tables and columns, field lineage, structured filters
and transformations, output fields, and chart/table layout. The engineer can edit
the structured definition, request changes with actionable feedback, save a new
revision, and approve the latest revision. Approval applies to the definition
structure—not report narrative or financial results.

After approval, the business user can request a simulated report using that
definition, including repeated requests. A newer pending revision withdraws the
older approval from the available-definitions list. Use Refresh or return focus
to synchronize the two screens; both share browser `localStorage`. Either screen
has a **Reset demo** button to clear the mock workflow for another presentation.

Schema names, columns, transformation logic, and artificial figures are sample
fixtures only. The preview is not a warehouse query result. This demo does not
integrate Ganesh's Agent Harness or Gandi's governed query/evidence services.

#### Demo walkthrough

1. On `/demo`, submit a mock mapping proposal.
2. On `/review`, inspect the pending definition and trace a source field through
   its transformation to output and layout.
3. Request changes with actionable feedback.
4. In `/review` History, correct the source-to-output mapping and save a new
   revision; it returns to Pending.
5. Approve the latest revision.
6. On `/demo`, request a mock report from the approved definition. The displayed
   artificial figures are labeled as simulated.
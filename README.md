# GenLedge Agentic Analytics

CSC301 team project for GenLedge's agentic analytics capability. The goal is to let business users request reports in plain language and have an analytics agent identify relevant warehouse data, ask clarifying questions when needed, and produce traceable reports for review.

## Deliverable 1

- Planning document: [`deliverables/D1/planning.md`](deliverables/D1/planning.md)
- Mockup links: [`deliverables/D1/mockup.md`](deliverables/D1/mockup.md)
- Interactive Figma prototype: [GenLedge Analytics Assistant](https://www.figma.com/design/RWN3CkOw0lzZCn4DFbcEUX/GenLedge-%25C2%25B7-Analytics-Assistant-%25E2%2580%2594-Interactive-Prototype?node-id=17-25446&p=f&t=Agtdm9Uu8ONuWML3-0)
- Prototype walkthrough: [Loom video](https://www.loom.com/share/2170564552cb445695b7ad81222e5a31)
- Team information: [`deliverables/team/`](deliverables/team/)

## Project status

This repository contains planning materials for Deliverable 1 and a minimal Next.js/React/TypeScript frontend and FastAPI backend scaffold. Project-specific analytics functionality has not started yet. The team is still finalizing the analytics engine stack, data warehouse interface with the other GenLedge CSC301 team, and repository/IP access details with GenLedge and course staff.

## Task management and communication

- Task tracking: Jira once GenLedge access is available; [Linear](https://linear.app/csc301-team/team/CSC/active) is being used temporarily for Deliverable 1 tasks.
- Partner communication: WhatsApp with GenLedge contacts Kulwant Yadav and Sapna Singhal.
- Internal communication: Discord for team coordination and PR review requests.
- Meeting minutes: [`deliverables/team/minutes/`](deliverables/team/minutes/)

## Development setup

The frontend uses Next.js, React, TypeScript, and Recharts for reusable analytics charts. The API uses FastAPI. Use Node.js 20.9 or newer and Python.

### Start both services on Windows

From the repository root, install the frontend dependencies and run the development launcher:

```powershell
Set-Location src\frontend
npm install
Set-Location ..\..
.\src\start-dev.ps1
```

The launcher checks or installs the Python backend requirements, starts the FastAPI backend if it is not already healthy, then starts the Next.js development server in a separate PowerShell window. Keep both service windows open. Open the frontend URL printed by Next.js (usually `http://localhost:3000`).

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

## External dependencies

Potential dependencies under consideration include:

- PostgreSQL for the analytics warehouse/data lake,
- an LLM or agent API for the analytics agent harness,
- a frontend/reporting interface framework,
- CI and deployment tooling.

Final choices will be documented here as they are made.

# GenLedge Agentic Analytics

CSC301 team project for GenLedge's agentic analytics capability. The goal is to let business users request reports in plain language and have an analytics agent identify relevant warehouse data, ask clarifying questions when needed, and produce traceable reports for review.

## Deliverable 1

- Planning document: [`deliverables/D1/planning.md`](deliverables/D1/planning.md)
- Mockup links: [`deliverables/D1/mockup.md`](deliverables/D1/mockup.md)
- Interactive Figma prototype: [GenLedge Analytics Assistant](https://www.figma.com/design/RWN3CkOw0lzZCn4DFbcEUX/GenLedge-%25C2%25B7-Analytics-Assistant-%25E2%2580%2594-Interactive-Prototype?node-id=17-25446&p=f&t=Agtdm9Uu8ONuWML3-0)
- Prototype walkthrough: [Loom video](https://www.loom.com/share/2170564552cb445695b7ad81222e5a31)
- Team information: [`deliverables/team/`](deliverables/team/)

## Project status

This repository contains planning materials for Deliverable 1 and a minimal React/TypeScript/Vite frontend and FastAPI backend scaffold. Project-specific analytics functionality has not started yet. The team is still finalizing the analytics engine stack, data warehouse interface with the other GenLedge CSC301 team, and repository/IP access details with GenLedge and course staff.

## Task management and communication

- Task tracking: Jira once GenLedge access is available; [Linear](https://linear.app/csc301-team/team/CSC/active) is being used temporarily for Deliverable 1 tasks.
- Partner communication: WhatsApp with GenLedge contacts Kulwant Yadav and Sapna Singhal.
- Internal communication: Discord for team coordination and PR review requests.
- Meeting minutes: [`deliverables/team/minutes/`](deliverables/team/minutes/)

## Development setup

The frontend scaffold uses React, TypeScript, and Vite. The backend scaffold uses FastAPI.

Run the frontend from `src/frontend`:

```sh
npm install
npm run dev
```

Run the backend from the repository root:

```sh
pip install -r requirements.txt
uvicorn src.backend.app:app --reload
```

The backend health endpoint is `GET /api/health`.

## External dependencies

Potential dependencies under consideration include:

- PostgreSQL for the analytics warehouse/data lake,
- an LLM or agent API for the analytics agent harness,
- a frontend/reporting interface framework,
- CI and deployment tooling.

Final choices will be documented here as they are made.

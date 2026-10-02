# Partner Meeting 01, Friday, September 25, 2026

**Type:** Partner meeting
**Date:** Fri, Sep 25, 2026, 4:30–5:30 p.m.
**Attendees:** Sapna Singhal, Kulwant Yadav, Ethan Brook, Marshal Guo, Yujin Kim, Addison Luo, Chengrui Song

## GenLedge overview

- ~10–12 people, build with Claude Code
- Agentic AI ERP; replaces manual entry (SAP / QuickBooks) with agents
- Agents do ~80% of manual work (e.g., financial planning); complex decisions still by humans

## Architecture

- **Existing ERP (in production):** Frontend ⟷ Backend + Agent Harness ⟷ DocumentDB (MongoDB)
- **Agentic Analytics Engine (new):** Reporting ⟷ Analytics + Agent Harness ⟷ Data Lake (Postgres)
- 2 data sources: DocumentDB + external (vendors, banks, customer CSVs)
- Data → data pipeline → data lake → analytics
- Analytics engine started in Node.js; Python also OK

## Project goal

- Today: user asks data engineer for report → engineer builds it
- Goal: AI agent acts as the data engineer
  - figures out data needed, config, report structure
- Pipeline agentic, not fixed rules; built per use case
- Agent proposes source → target mapping → engineer reviews + approves
- Requests can come from users or be agent-initiated

## Scope / team split

- 2 CSC301 teams on GenLedge:
  - agentic data pipeline
  - agentic analytics
- Our scope = new analytics side ("right half"); ERP ("left half") already built

## Decisions

- Us: agentic analytics + agent harness
- Other team: data pipeline
- All PRs peer-reviewed (code goes to production)
- Weekly partner standup: Thu 6 p.m.
- WhatsApp for quick questions / logistics
- Jira for tasks + user stories (we write stories)

## Notes from partner

- Use Jira timelines to divide tasks
- Only take high-impact tasks if you can deliver production-quality code

## Open questions

- NDA: course says no NDA, only written confidentiality acknowledgement → confirm with Salman + GenLedge
- Boundary / interface with pipeline team?
- Primary product contact vs. technical contact?

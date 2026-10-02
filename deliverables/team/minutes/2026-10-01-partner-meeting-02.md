# Partner Meeting 01, Friday, September 25, 2026

**Type:** Partner meeting
**Date:** Thu, Oct 1, 2026, 6:00–6:30 p.m.
**Attendees:** Sapna Singhal, Kulwant Yadav, Gandi Erdenebaatar, Yujin Kim, Addison Luo, Chengrui Song (+ Team 1)

Use plan mode in coding agent and save the .md docs
Focus on building agent harness. Research on muse.ai, instinct ai, leaked claude code src
 
**Demo agent harness on the next meeting.**
 
## NDA/IP Status

- NDA/IP agreement still unresolved, waiting on David
- GenLedge cannot share company code or repo access until agreement is signed
  - If signed: students get access to Generalized repo and company code
  - If not signed: students build in a private repo; code stays there until resolved
- GenLedge also will not use student code without a signed agreement
  - MIT license doesn't help: makes code open source, which GenLedge can't build enterprise IP on
- Data access follows the same rule
  - Signed NDA/IP: access to Generalized data
  - No agreement: use synthetic datasets or publicly available data
  - Sample schemas may be shareable, but even schemas are considered internal IP

## Architecture

- Current GenLedge stack: Node, Next.js, MongoDB, AWS ecosystem (queues, etc.), LangGraph on the Agentic side
- Team is free to choose their own tech stack, not restricted to Node
  - Python is fine for analytics; Node fine for general dev; both are comparable at this scale
  - Don't spend too much time debating: pick one and move forward
- Avoid too much hand-written code: use coding agents (Claude Code, Codex, Gemini, etc.)

## Q&A
 
- PR and merging best practices
  - Branch structure: feature → dev → staging → main
  - Always pull latest dev before pushing; merge locally and test before pushing to dev
  - At least one peer must review and test before merging
  - Use a coding agent to write a detailed plan; store it in a /docs folder per repo
  - Keep docs updated as code evolves; agent should update docs alongside code changes
- Order of what to build
  - Build the agentic engine first; specific report type or UI quality is secondary
  - Spend as little time as possible on backend and frontend
  - Focus on the agent harness: tools, context, memory management, instructions, SOPs
    - Not the model itself (not building a foundational model)
    - The scaffolding around the model is what matters
  - Both teams (data pipeline and analytics engine) are building agent harnesses and can coordinate
- Success criteria
  - Working autonomous data pipeline and autonomous reporting engine
  - Teams define their own specific targets

## Next Steps
 
- **Research and prepare an agent harness architecture proposal**
- **Follow up with David on NDA/IP resolution**
 
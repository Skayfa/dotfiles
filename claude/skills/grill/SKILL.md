---
name: grill
description: Challenge a subject/spec/ticket before building, by confronting it to 4 sources (sillon transcripts & decisions, the Notion epic, the codebase, client insights). Surfaces gaps, contradictions, missing acceptance criteria, and pending questions, and produces an explicit testable acceptance-criteria checklist. Use right after intake of a feature/improvement/bug, before writing any code.
---

# Grill

Frame the subject against reality, so we ship what was actually asked for. This step scopes; it does not code.

## Inputs

- **Ticket / epic** — Notion MCP: `Plan`, `Type`, `Epic`, criteria.
- **Sillon subject**, if one exists — sillon MCP `get_subject`: goal, decisions, REX/log, open points.
- **Codebase** — read the code involved.
- **Client insights** — via sillon / Notion.

## Depth by `Type`

- **Feature** — deep: scope, edge cases, full criteria.
- **Improvement** — frame "before → after" + criteria for the delta.
- **Bug** — repro + root cause + a "fixed when…" criterion.

## Confront the 4 sources

1. **Transcripts / decisions (sillon)** — does what was said or settled contradict or refine the ticket?
2. **Epic (Notion)** — does this serve the epic's goal? anything out of scope?
3. **Codebase** — feasibility, existing patterns to reuse, conflicts, impact, debt induced.
4. **Client insights** — does the real need match the written request?

## Output

- **Acceptance criteria** — a testable checklist. This is the deliverable.
- **Gaps, ambiguities, contradictions** across the 4 sources.
- **Pending questions** to settle, and with whom.
- **Codebase risks** — conflicts, refactor needed, impact.
- **Verdict** — ready to code, or blocking questions first?

Always end with: the acceptance-criteria checklist + the open questions. Do not propose an implementation.

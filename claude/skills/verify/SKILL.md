---
name: verify
description: Faithfulness gate before shipping. Generates a test plan from the agreed acceptance criteria, runs the project's test command (from AGENTS.md), and checks every criterion is covered by a passing test. Refuses to ship if any criterion is uncovered or failing. Use after building, before opening the MR/PR.
---

# Verify

Ship only what covers every acceptance criterion agreed at `grill`.

## Steps

1. **Collect the criteria** from the contract (grill / Notion `Plan` / `task/plans/ET-XXXX.md`).
2. **Build the test plan** — for each criterion, the test(s) that prove it: unit, integration, or manual.
3. **Run the project's tests** — the command from the repo's `AGENTS.md`, section "Comment tester" (e.g. dolmen `task test-pkg PKG=…`, exelab `pnpm test`, proof-cast `make test`). Never bypass the guards (raw `go test` is blocked in dolmen).
4. **Coverage matrix** — `criterion → test → ✅ / ❌`. List uncovered criteria explicitly (test missing or failing).
5. **Put the verdict in the diff** — if a hunk session is live (`hunk session list`), post each uncovered criterion as an inline note on the offending file and line (`❌ Uncovered criterion: …`), with `--focus` on the first. An uncovered criterion is actionable next to the code, not in the chat. Commands: skill `hunk-review`. No session open → skip this step.
6. **Verdict**
   - Any criterion uncovered, or any test failing → **do not ship**; list precisely what is missing.
   - All covered, tests green → **ready for MR/PR**.

Always end with: the coverage matrix + the verdict (ship / no ship). On "no ship", give the remaining todo.

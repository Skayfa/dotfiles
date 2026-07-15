---
name: distill
description: Extract a generalizable pattern from the work just done into the reference-patterns repo (~/Workspace/learning/reference-patterns) as a self-contained, tested example — including the Path (what was tried and rejected before the final solution). Strips everything client-specific; the repo is public. Use at the end of a piece of work when a reusable technique was learned, or when the user says "distill this".
---

# Distill

Turn what was just learned into a reusable, tested pattern in
`~/Workspace/learning/reference-patterns`. The repo is **public**: nothing
client-specific ever goes in.

## Steps

1. **Spot the pattern** — reread the session's work (diff, commits, decisions).
   What here is a generalizable technique, not project plumbing? One pattern =
   one idea; a changeset can yield several, or none. Nothing generalizable →
   say so and stop.
2. **Check the index** — read `llms.txt` in the repo. Same idea already there →
   update the existing pattern instead of duplicating it.
3. **Genericize** — rebuild the example from scratch in the pattern repo, never
   copy client files: neutral domain (user, newsletter, order…), no client
   names, URLs, business rules, or proprietary code. Keep the minimal surface
   that carries the idea; note in Key points what was deliberately left out.
4. **Scaffold** — copy `templates/pattern/PATTERN.md` to
   `<language>/<category>/<slug>/` and follow the repo's `AGENTS.md`
   (self-contained, no cross-pattern imports, `catalog:` versions for
   TypeScript, module in `go.work` for Go).
5. **Write the Path** — the section the final code cannot show: what was tried
   first, why it was rejected, what the decisive discovery was. Pull it from
   this session and the source project's git history — never invent it.
   Fill `origin` in the frontmatter (source project + month, sillon subject
   slug if one exists).
6. **Verify & index** — `./scripts/generate-llms.sh`, then
   `./scripts/test-all.sh` must pass. Fix until green.
7. **Hand off** — leave the changes uncommitted (review happens in hunk,
   commit in lazygit) and suggest a commit message.

Always end with: the pattern path(s), the test result, and the suggested
commit message.

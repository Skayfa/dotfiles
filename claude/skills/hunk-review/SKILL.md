---
name: hunk-review
description: Narrate a code review inside the user's live hunk TUI session by posting inline annotations on the diff itself, tied to the acceptance criteria agreed at grill. Use when a hunk session is running (`hd`, `hd --watch`, or tmux prefix+h) and the user asks for a review, a walkthrough of a changeset, or feedback before shipping.
---

# Hunk-review

Put the review where the code lives: inline notes in the session the user is looking at, not in the chat.

## Read the manual first

```bash
hunk skill path    # resolve every time — the path is version-pinned
```

That file is the reference for all `hunk session *` syntax. Read it; don't guess an option.

**Never run `hunk diff` or `hunk show` yourself** — they are interactive and will hang. The TUI belongs to the user. No session? Ask them to open one (`hd`, or tmux `prefix h`).

## What this adds to the manual

- **Anchor on the contract.** Judge remarks against the acceptance criteria agreed at `grill`, not personal taste. A note tied to no criterion, risk, or past decision is noise.
- **Priority**: uncovered criterion > bug or regression > broken API contract > security or perf > structure > style.
- Notes are English (they live next to the code); the chat stays in the user's language.
- `verify` judges criteria coverage and its uncovered criteria land here as notes. Don't re-run tests.

Always end with: the notes posted (file:line → summary), then what blocks the ship vs optional follow-up. Nothing to flag? Say so rather than inventing notes.

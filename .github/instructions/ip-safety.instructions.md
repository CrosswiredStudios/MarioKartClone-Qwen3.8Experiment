---
description: "Use when: naming characters, vehicles, maps, items, or any user-visible string; adding assets; running the release IP gate. Enforces the zero-Nintendo-IP rule."
name: "IP Safety Rules"
---

# IP Safety Rules

**Zero Nintendo intellectual property — hard rule, no exceptions.**

All characters, vehicles, maps and items are original pun-based creations. The authoritative banned-name list and the full decision record live in [`docs/plans/00-overview.md`](../../docs/plans/00-overview.md) §2 — read that section before naming anything new.

## The release gate

```
grep -rinE "mario|luigi|peach|bowser|yoshi|wario|waluigi|koopa|donkey kong" src docs index.html
```

must return **only the two documented meta-hits** (the banned-name reference list in `00-overview.md` §2 and the quoted command in `09-phase-7-final-qa.md`).

## Rules

- **Never add allowlist entries to make the gate pass — fix hits at the source.**
- **`toad` is deliberately NOT banned** (common English word) — but prefer "Turtle" in this project's naming.
- The map `meadows` displays as **"Greenhollow Meadows"** — never the raw key in user-visible text.
- **Do not re-list banned names in new docs** — that adds grep hits. Link to `00-overview.md` §2 instead.
- New names must be original puns (e.g. Pearl, Terry, Zippy) — check the existing rosters in `src/data/characters.ts` and `src/data/vehicles.ts` for the established style.

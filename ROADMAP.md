# Roadmap — Card Collector v2

> **Auto Continue reads this file.** The `feature` phase takes the first unchecked
> `- [ ]` line below as its whole brief and ticks it by exact text, so milestones and
> phases are headings and every slice is one commit-sized, self-contained line.
> **Human-only** items carry no checkbox, so Auto never picks them up.

**Now:** no milestone queued — feature-complete per the 2026-09-25 assessment, plus the
2026-10-03 Organise work below and the 2026-11-21 MCP server. Reviewed 2026-11-21.

## Done
- [x] **A whole-repo audit, and the twenty defects it found** — 2026-11-21. The Subtype
  filter was dead against the real catalogue (the type line carries an em dash and the
  split looked for a hyphen); a card an import filed could not be found again, because
  the holding was keyed by a language the catalogue does not carry; a generator that died
  half way destroyed the catalogue it was replacing; the harness could not run on a fresh
  clone; and the Config page printed a command from a deleted app. All twenty are fixed
  and recorded in ISSUES.md, each with what was measured.
- [x] **An MCP server over the catalogue** — `mcp-server.mjs` speaks MCP over stdio and
  answers five read-only questions from the same files the page reads: `list_sets`,
  `list_cards`, `get_card`, `collection_stats`, `find_gaps`, plus `cards://sets` and
  `cards://stats`. It resolves an export row to a printing with the page's own import
  path — the script runs in a `node:vm` and calls `readImport` — so the server cannot
  disagree with the app about what a row means. No dependency; check.mjs talks to it
  over its own transport.
- [x] **Organise: suggest a binder layout from set completion** — after import, propose
  one binder per set at or above an adjustable completion threshold (default 50%,
  slider), most complete first, plus one "Generic sorted" binder for the rest. Review,
  then Apply through the existing grouping/Apply path. Decided 2026-10-03:
  - deck cards **count** toward completion but **stay in their decks**
  - Generic sorted order: colour (W U B R G, multi, colourless, lands) → name
  - a set binder holds **one copy** of each card; spare copies go to Generic sorted
  - shipped 2026-10-03: Binders → Organise…; check.mjs covers threshold, one-copy, deck-stays, no copy lost

# Roadmap — Card Collector v2

> **Auto Continue reads this file.** The `feature` phase takes the first unchecked
> `- [ ]` line below as its whole brief and ticks it by exact text, so milestones and
> phases are headings and every slice is one commit-sized, self-contained line.
> **Human-only** items carry no checkbox, so Auto never picks them up.

**Now:** no milestone queued — feature-complete per the 2026-09-25 assessment, plus the
2026-10-03 Organise work below. Reviewed 2026-10-09.

## Done
- [x] **Organise: suggest a binder layout from set completion** — after import, propose
  one binder per set at or above an adjustable completion threshold (default 50%,
  slider), most complete first, plus one "Generic sorted" binder for the rest. Review,
  then Apply through the existing grouping/Apply path. Decided 2026-10-03:
  - deck cards **count** toward completion but **stay in their decks**
  - Generic sorted order: colour (W U B R G, multi, colourless, lands) → name
  - a set binder holds **one copy** of each card; spare copies go to Generic sorted
  - shipped 2026-10-03: Binders → Organise…; check.mjs covers threshold, one-copy, deck-stays, no copy lost

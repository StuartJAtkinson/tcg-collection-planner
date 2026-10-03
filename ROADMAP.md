# Roadmap — Card Collector v2

## Done
- [x] **Organise: suggest a binder layout from set completion** — after import, propose
  one binder per set at or above an adjustable completion threshold (default 50%,
  slider), most complete first, plus one "Generic sorted" binder for the rest. Review,
  then Apply through the existing grouping/Apply path. Decided 2026-10-03:
  - deck cards **count** toward completion but **stay in their decks**
  - Generic sorted order: colour (W U B R G, multi, colourless, lands) → name
  - a set binder holds **one copy** of each card; spare copies go to Generic sorted
  - shipped 2026-10-03: Binders → Organise…; check.mjs covers threshold, one-copy, deck-stays, no copy lost

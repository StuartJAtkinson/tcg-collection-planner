# MCP — card-collection

**Design spec.** No MCP server exists yet.

- **Proposed server:** `card-collection`
- **Transport:** stdio
- **Backs onto:** the static data index `index.html` reads

## Why this repo wants one

It is catalogue-first: the whole app is `index.html` at the repo root plus a
data index, served at **http://localhost:5255/**. There is no backend, which
makes the MCP surface unusually clean — it is a *reader over a catalogue*, and
"what am I missing from this set", "how many foils do I have", "what did I add
last month" are exactly what a catalogue is for.

## Tools

| Tool | Params | Returns |
|---|---|---|
| `list_sets` | — | sets in the catalogue with counts |
| `list_cards` | `set?`, `q?`, `owned?`, `limit?` | cards, filtered |
| `get_card` | `id` | one card with its variants (front/back, foil) |
| `collection_stats` | `set?` | owned vs total, by set and rarity |
| `find_gaps` | `set` | what's missing from a set you're working on |

`find_gaps` is the tool worth building the server for. Everything else is
browsable in the page; "what do I still need" is the question that is tedious
by hand and trivial for a query.

## Resources

| URI | Contents |
|---|---|
| `cards://sets` | set index with counts |
| `cards://stats` | ownership summary |

## What must NOT be a tool

- **Anything that edits ownership.** Marking a card owned is a claim about the
  physical world. A model cannot check it and has every incentive to infer it
  from conversation. Wrong ownership data is worse than none — it makes
  `find_gaps` lie, and `find_gaps` is the whole point of the collection.
- **Anything that writes the catalogue.** `gen-boosters.mjs`, `frames.mjs`,
  `anatomy.js` and `check-dead.mjs` are build steps, not tools.

## Implementation note

Because the app is static and hash-routed, an MCP server reads the same data
index the page does — no server process to keep in sync, no second source of
truth. That is the cheapest possible shape: one reader, one file, no drift.
Keep it that way rather than introducing an API for the server's benefit.

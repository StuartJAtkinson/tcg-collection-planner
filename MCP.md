# MCP — card-collection

**Built.** `node mcp-server.mjs [collection.csv]` — stdio, no dependency, read-only.

- **Server:** `card-collection`
- **Transport:** stdio
- **Backs onto:** the static data index `index.html` reads

The tool names below are what it serves. `collection_stats` and `find_gaps`
answer from what you own, which is read from the export your collection tool
writes — `MTGCards.csv` by default — and resolved to printings by the page's
own import path, so the two agree on what a row means.

## Why this repo wants one

It is catalogue-first: the whole app is `index.html` at the repo root plus a
data index, served at **http://localhost:5255/**. There is no backend, which
makes the MCP surface unusually clean — it is a *reader over a catalogue*, and
"what am I missing from this set", "how many foils do I have", "what did I add
last month" are exactly what a catalogue is for.

## Tools

| Tool | Params | Returns |
|---|---|---|
| `list_sets` | `q?`, `limit?` | sets in the catalogue with counts |
| `list_cards` | `set?`, `q?`, `owned?`, `limit?` | cards, filtered |
| `get_card` | `id`, `limit?` | one card with every printing of it |
| `collection_stats` | `set?`, `limit?` | owned vs total, by set and rarity |
| `find_gaps` | `set`, `limit?` | what's missing from a set you're working on |

`find_gaps` is the tool worth building the server for. Everything else is
browsable in the page; "what do I still need" is the question that is tedious
by hand and trivial for a query.

**EVERY ANSWER IS CAPPED, AND SAYS WHAT IT LEFT OUT.** The lists carry a
`total` (or `found`) and a `shown`, and the shown one is the smaller. This is
not decoration: `get_card("Forest")` covers 864 printings, and uncapped it
was 290 KB of JSON — 72,000 tokens in one tool result, most of a model's
context spent on a list it will not read, and a client that caps tool output
truncates the JSON mid-string. The caps are 100 sets, 200 cards, 200
printings and 1,000 gaps.

**THE COLLECTION FILE IS WATCHED, NOT READ ONCE.** The browser's holdings are
newer than the export, so a server that read the file at startup answered
about yesterday: buy a card, re-export, and `find_gaps` still said you were
missing it. The file's timestamp is checked before every call.

**A CARD THAT IS NOT THERE SAYS SO.** `get_card` throws "no card called ..." 
rather than answering `null`, because a name that does not exist, a spelling
that does not match and a set/number that is not in the catalogue all used to
answer the one word null, and a model could not tell which of the three it had
got wrong.

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

**Which is why the server runs the page's script.** Matching an export row to
a printing is the delicate half of the import — Collectr gives the set by
name, leaves the collector number blank on 936 of its 2,796 rows, writes the
variant into the product name, and states the foil in a column one field away
from the question. Those rules live in `index.html`, where they have already
been bought with three rounds of wrong answers. So `mcp-server.mjs` runs that
script in a `node:vm` — the same trick `check.mjs` uses — and calls
`readImport`. One implementation, so "which printing is this row" cannot mean
two things, and the cost is that the server needs `index.html`, `sets.js` and
`cards.json.gz` sitting next to it.

**No dependency.** The stdio transport is JSON-RPC 2.0 with one message per
line, and this server needs five methods. The official SDK would be the first
runtime dependency in a repo that has none.

# docs/

Prose is the first two; the rest is **evidence**, and it is here because it
cannot be regenerated. The scripts that first produced the JSON — `count_schema_fields.ts`,
`probe_composite_key.ts`, `build_schema_xlsx.py` — were deleted with the Next.js
app in August 2026. What they measured is still the reason several decisions in
[ISSUES.md](../ISSUES.md) went the way they did, so the numbers stay.

Two of them are live inputs: `gen-schema.mjs` builds `schema.js` from
`schema-rows.json` + `schema-counts.json`, and `gen-schema-counts.mjs` fills the
gaps in `schema-counts.json`. The other two — `composite-key-probe.json` and the
spreadsheet — are **dated measurements**: nothing reads them, and re-deriving
one means writing the script again.

| file | what it is |
|---|---|
| [sources.md](sources.md) | where card data comes from and which source wins a conflict |
| [import-formats.md](import-formats.md) | the ten exporter formats, read by `index.html` |
| `schema-rows.json` | the Scryfall ↔ MTGJSON field map — which field on one side answers to which on the other, grouped by concern. The mapping itself is still true; it is the table `schema-scryfall-vs-mtgjson.xlsx` was built from. |
| `schema-counts.json` | how many cards on each side actually carry each of those fields, measured over 116,568 Scryfall and 112,605 MTGJSON records. This is what "MTGJSON has it but only for half the catalogue" was decided on. |
| `composite-key-probe.json` | the probe behind the composite key: 538,675 Scryfall lines, 529,318 paper, and the language histogram that showed set+number is not unique until language joins it. |
| `schema-scryfall-vs-mtgjson.xlsx` | the same comparison as a spreadsheet, for reading away from a terminal. |

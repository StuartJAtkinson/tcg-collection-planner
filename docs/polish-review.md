# Polish review — the ux and docs phases, merged into one list

The unattended loop ran `ux` and `docs` as two separate phases and kept passing
both: each is judged done by "a turn happened", so with nothing left to find
they alternated forever without changing the repo. The fix is not a bigger
backlog — it is **one polish pass, triaged by a human before any of it runs**.

Everything the two phases would still propose is below, point by point. Tick
**Yes** to keep an item (it becomes an `ISSUES.md` open bullet and the loop can
pick it up) or **No** to drop it for good. Anything left unticked stays out of
the loop, which is the point: an untriaged polish item is how the phases spun.

Facts checked against the tree at `84cfeb7`, not remembered.

## Layout / UI

1. **Sub-header bar on the remaining pages** — Config and Home were given a
   matching sub-header bar (`f3489d6`, `6544087`, `0453f58`). Printings,
   Binders, Decks and Search still each carry their own sub-header shape
   (selector-collapses-to-title, counts, Back + sub-select).
   Unify them on the Config/Home bar? — [ ] Yes  [ ] No
   *Drop if:* the scoped pages' sub-header genuinely carries different work
   (Back, sub-select, counts) and sameness would cost function.

2. **Set symbol beyond the group headings** — the symbol sits next to each set
   block in binder/deck/grid headings (`1a25068`). It does not appear in the
   compact or details rows, nor in the Printings table.
   Put it in the rows too? — [ ] Yes  [ ] No
   *Drop if:* a symbol per row is noise at 154 rows and the heading is where the
   set is actually being named.

3. **`index.html` is 8,368 lines in one file** — the whole app, with the design
   reasoning in comments beside the code it explains.
   Split it into modules? — [ ] Yes  [ ] No
   *Drop if:* one file with no build step is the deliberate shape and the
   comments lose their subject when the code moves.

4. **Live triggers for the other generators** — only `gen-packs.mjs` has a
   Config trigger and a progress bar (through `gen-packs-server.mjs` on
   `localhost:5245`). `gen-art`, `gen-symbols`, `gen-cards`, `gen-boosters`
   show a copyable command instead.
   Give them the same live trigger? — [ ] Yes  [ ] No
   *Drop if:* copy-the-command is the norm and gen-packs is the one exception
   that earned a bar, because it is the only multi-hour fetch.

5. **The `#/anatomy` sample page** — a whole route plus 34 MB of fetched art
   (`gen-art.mjs --anatomy`) that exists to show the five plates of a card.
   Keep it shipped? — [ ] Yes  [ ] No
   *Drop if:* it is a development aid that outlived the `MockCard.tsx` rebuild
   it was verifying.

## Docs / repo tidiness

6. **~30 iteration screenshots on disk** — `config-schema-v2..v15` and friends
   in `screenshots/`, plus the working shots at the repo root. All gitignored,
   none tracked, nothing references them.
   Delete them from disk? — [ ] Yes  [ ] No
   *Drop if:* they are the visual record of the schema page's iterations and
   disk is free.

7. **`MCP.md` sits at the repo root** while every other prose doc lives in
   `docs/`.
   Move it to `docs/`? — [ ] Yes  [ ] No
   *Drop if:* root is the right shelf for a file about how to attach to this
   repo, next to `README.md`.

8. **The `docs/` evidence JSON cannot be regenerated** — `schema-rows.json`,
   `schema-counts.json` and `composite-key-probe.json` were produced by three
   scripts deleted with the Next.js app in August 2026.
   Rewrite the probe scripts? — [ ] Yes  [ ] No
   *Drop if:* `docs/README.md` already labels them dated measurements and
   nothing in the build reads them, so a live probe would be a second source of
   truth for a question already answered.

## Loop hygiene

9. **Merge `ux` and `docs` into one `polish` phase** in the atelier harness, so
   a lap cannot alternate between two always-passing phases. — [ ] Yes [ ] No
   *Note:* this is a change in `H:\GitHub\atelier-harness`
   (`src/meta/phases.rs`, `PHASE_ORDER`), not in this repo. Ticking it here only
   records the intent.

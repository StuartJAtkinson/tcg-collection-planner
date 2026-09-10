// Compiles draft.css from index.html using the project's own Tailwind 4.
// Run after editing index.html:  node build.mjs
//
// ponytail: precompiled rather than the @tailwindcss/browser runtime JIT - the draft's
// markup is injected by JS, so a runtime scanner has to catch it via MutationObserver and
// silently yields an unstyled page when it doesn't. A static file either contains the
// classes or it doesn't, and that's greppable.
//
// AND IT RECORDS WHAT IT WAS BUILT FROM. This file is a generated artefact that
// is checked in, so it can fall behind the markup with nothing to notice - and it
// did, for three weeks: BTN_DANGER was restated in rose and never rebuilt, so the
// stylesheet carried 0 rose rules and the Clear holdings button rendered with no
// background, no border and no disabled state. The failure mode is the worst kind,
// because a missing class is not an error anywhere - the page just quietly looks
// wrong. The fingerprint goes in a comment at the top of draft.css rather than in
// a file beside it: provenance that can be separated from the artefact is
// provenance that will be. `packs/.recipe.json` is the same idea for pack art.
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// source(none) turns OFF automatic source detection. Without it Tailwind scans the
// directory it is run from, which is now the repo root - it would walk app/, src/,
// migrations/ and .next/ and fold their classes into this stylesheet.
const input = `@import "tailwindcss" source(none);\n@source "./index.html";\n${readFileSync('foil.css', 'utf8')}`;
const { css } = await postcss([tailwind()]).process(input, { from: 'input.css', to: 'draft.css' });

/* BOTH INPUTS, not just the markup: foil.css is concatenated in above, so an edit
   to it changes the output exactly as an edit to index.html does. Twelve hex
   digits - this is a cache key, not a security boundary. check.mjs recomputes
   this the same way rather than importing it, because importing this file would
   run the whole Tailwind build to get at one hash. */
const recipe = createHash('sha1')
  .update(readFileSync('index.html')).update(readFileSync('foil.css')).digest('hex').slice(0, 12);
writeFileSync('draft.css', `/* built by build.mjs from index.html + foil.css - recipe ${recipe} */\n${css}`);
console.log(`draft.css - ${(css.length / 1024).toFixed(1)} KB - recipe ${recipe}`);

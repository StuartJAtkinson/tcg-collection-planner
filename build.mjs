// Compiles draft.css from index.html using the project's own Tailwind 4.
// Run after editing index.html:  node build.mjs
//
// ponytail: precompiled rather than the @tailwindcss/browser runtime JIT — the draft's
// markup is injected by JS, so a runtime scanner has to catch it via MutationObserver and
// silently yields an unstyled page when it doesn't. A static file either contains the
// classes or it doesn't, and that's greppable.
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { readFileSync, writeFileSync } from 'node:fs';

// source(none) turns OFF automatic source detection. Without it Tailwind scans the
// directory it is run from, which is now the repo root — it would walk app/, src/,
// migrations/ and .next/ and fold their classes into this stylesheet.
const input = `@import "tailwindcss" source(none);\n@source "./index.html";\n${readFileSync('foil.css', 'utf8')}`;
const { css } = await postcss([tailwind()]).process(input, { from: 'input.css', to: 'draft.css' });
writeFileSync('draft.css', css);
console.log(`draft.css — ${(css.length / 1024).toFixed(1)} KB`);

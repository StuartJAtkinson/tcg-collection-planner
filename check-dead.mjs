/* DEAD SYMBOL FINDER, for a codebase an AST tool cannot read honestly.

   Why not just run ESLint's no-unused-vars: this app is ONE index.html whose
   ~8,000 lines of inline JS wire almost every control through inline handler
   attributes built inside template strings -

       chip('none', '', '', `setElt('${key}',null,null,null)`)

   `setElt` there is a substring, not a call. A static analyser sees no
   reference, reports it dead, and deleting it breaks the page. The same goes
   for every onclick target in the file. So the reference count has to include
   string occurrences, which is exactly what a linter is built NOT to do.

   This counts every whole-word occurrence of each top-level declaration across
   the whole file, then classifies:
     dead        declared once, never mentioned again - a real candidate
     handler     only ever referenced from inside an on*="..." attribute
     live        referenced from code

   `handler` is the interesting column: it is the set a linter would wrongly
   delete, and it is why this file exists rather than an .eslintrc.

   Run: node check-dead.mjs           (add --verbose to list handler-only)  */
import { readFileSync, readdirSync } from 'node:fs';

const FILES = ['index.html'];
const verbose = process.argv.includes('--verbose');

/* THE HARNESS COUNTS AS A CALLER. check.mjs runs the page inside a vm context
   and reaches back into it BY NAME - `t.srcQualities(k)`, `t.goOffline('full')`
   - so a symbol the page no longer calls can still be the thing a test drives.
   Scanning index.html alone reports four of those as dead, and deleting them
   breaks the suite rather than the page. Every sibling script is searched. */
const OTHER = readdirSync('.')
  .filter(f => /\.(mjs|js)$/.test(f) && f !== 'check-dead.mjs')
  .map(f => ({ f, text: readFileSync(f, 'utf8') }));

for (const file of FILES) {
  const src = readFileSync(file, 'utf8');

  // top-level declarations: this file declares at column 0, which is also what
  // makes "top level" decidable without parsing
  const decls = [...src.matchAll(/^(?:const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/gm)]
    .map(m => m[1]);
  const uniq = [...new Set(decls)];

  // everything inside an inline handler attribute - the blind spot
  const handlers = (src.match(/\son\w+="[^"]*"/g) || []).join(' ');

  const esc = s => s.replace(/[$]/g, '\\$&');
  const tally = (hay, name) => (hay.match(new RegExp(`\\b${esc(name)}\\b`, 'g')) || []).length;

  const dead = [], handlerOnly = [], harnessOnly = [];
  for (const name of uniq) {
    const total = tally(src, name);
    const inHandlers = tally(handlers, name);
    const elsewhere = OTHER.filter(o => tally(o.text, name) > 0).map(o => o.f);
    // one occurrence is the declaration itself
    if (total <= 1) (elsewhere.length ? harnessOnly : dead).push({ name, where: elsewhere.join(', ') });
    else if (inHandlers > 0 && total - 1 === inHandlers) handlerOnly.push({ name, refs: inHandlers });
  }

  console.log(`${file}: ${uniq.length} top-level declarations`);
  console.log(`  live                ${uniq.length - dead.length - handlerOnly.length - harnessOnly.length}`);
  console.log(`  handler-only        ${handlerOnly.length}   <- a linter would call these dead`);
  console.log(`  used only by tools  ${harnessOnly.length}   <- dead on the page, driven by a sibling script`);
  console.log(`  never referenced    ${dead.length}   <- real candidates`);

  if (harnessOnly.length) {
    console.log('\n  USED ONLY OUTSIDE THE PAGE');
    for (const h of harnessOnly) console.log(`    ${h.name.padEnd(24)} ${h.where}`);
  }

  if (handlerOnly.length && verbose) {
    console.log('\n  HANDLER-ONLY (safe, wired through on*="..." strings)');
    for (const h of handlerOnly.sort((a, b) => b.refs - a.refs))
      console.log(`    ${h.name.padEnd(24)} ${h.refs} handler reference${h.refs === 1 ? '' : 's'}`);
  }

  if (dead.length) {
    console.log('\n  NEVER REFERENCED');
    for (const { name } of dead) {
      const at = src.search(new RegExp(`^(?:const|let|var|function|async function)\\s+${esc(name)}\\b`, 'm'));
      console.log(`    ${file}:${src.slice(0, at).split('\n').length}  ${name}`);
    }
  } else {
    console.log('\n  nothing is declared and never mentioned again');
  }
}

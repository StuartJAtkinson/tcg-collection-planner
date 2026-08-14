// Turn a screen recording into something an agent can actually look at.
//   node frames.mjs <video> [startSeconds] [durationSeconds]
//
// ponytail: Claude cannot watch a video — it reads images. So this does not
// make a GIF (a GIF is for a human to review); it makes CONTACT SHEETS: one PNG
// per 24 frames, laid out 6x4, which is one look instead of twenty-four. Frames
// are also written individually so any single moment can be read full size.
//
// Defaults to 12fps over the whole clip. For an animation you are trying to
// copy, pass a start and a duration and cut it to the one pack opening —
// 3 seconds at 12fps is 36 frames, which is two sheets and plenty.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';

const [video, start, dur] = process.argv.slice(2);
if (!video) { console.error('usage: node frames.mjs <video> [start] [duration]'); process.exit(1); }

const FPS = 12, COLS = 6, ROWS = 4, WIDE = 480;   // per-frame width in the sheet
const OUT = 'ref';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/frames`, { recursive: true });

const clip = [...(start ? ['-ss', start] : []), ...(dur ? ['-t', dur] : [])];
const run = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args]);

// individual frames, for reading one moment closely
run([...clip, '-i', video, '-vf', `fps=${FPS},scale=${WIDE}:-1`, `${OUT}/frames/f%03d.png`]);
const n = readdirSync(`${OUT}/frames`).length;

/* Contact sheets. `tile` needs its own fps filter rather than reusing the
   frames above, because ffmpeg's tile pads the LAST sheet with black and
   emits it only if the filter graph is flushed — running it as its own pass
   keeps the frame numbering on the sheets honest against the folder. */
run([...clip, '-i', video, '-vf',
  `fps=${FPS},scale=${WIDE}:-1,drawtext=text='%{n}':x=8:y=8:fontsize=28:fontcolor=yellow:box=1:boxcolor=black@0.6,`
  + `tile=${COLS}x${ROWS}:padding=4:color=0x111111`,
  '-fps_mode', 'vfr', `${OUT}/sheet%02d.png`]);

const sheets = readdirSync(OUT).filter((f) => f.startsWith('sheet'));
const kb = (f) => `${(statSync(`${OUT}/${f}`).size / 1024).toFixed(0)} KB`;
console.log(`${n} frames at ${FPS}fps -> ref/frames/`);
console.log(`${sheets.length} contact sheet(s): ${sheets.map((f) => `${f} (${kb(f)})`).join(', ')}`);
console.log(`each sheet is ${COLS}x${ROWS} frames, numbered — read ref/sheet01.png first`);

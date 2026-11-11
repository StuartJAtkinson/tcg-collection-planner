// Local server that runs gen-packs.mjs on demand and streams its stdout back
// over Server-Sent Events, so the Config page can show a live progress bar.
// The button on the page is a trigger + display, not a reimplementation - this
// file is the only piece of orchestration the page needs.
//
// Runs as `node gen-packs-server.mjs` and binds to localhost:5245. Spawned by
// the npm script "gen-packs" so the user only ever types one command.
// Browser requests are accepted only from the page's own origin (or the page
// opened as a file): a POST here starts a download, and CORS alone does not stop
// another site from sending one.
//
// State model: ONE concurrent run. POST /run while a run is in flight returns
// 409. The button in the page is disabled while a run is happening. Anything
// more is two-button UI for one process, which is what we are trying to avoid.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync, existsSync } from 'node:fs';

const PORT = 5245;
let running = null;       // child_process or null - tracks the one allowed run
const ORIGINS = new Set(['http://localhost:5255', 'http://127.0.0.1:5255', 'null']);

const send = (res, event, data) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

const server = createServer((req, res) => {
  // CORS for the page. Same-origin would mean serving both from one port, which
  // would mean the page cannot be opened as a file - which it can, today. So
  // open CORS, localhost-only is the real guard.
  // ...but CORS only stops a page READING the answer; a plain POST from any site
  // you have open still runs. So a browser request from anywhere else is refused
  // outright. 'null' is the page opened as a file.
  const origin = req.headers.origin;
  if (origin && !ORIGINS.has(origin)) { res.writeHead(403); return res.end(); }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'POST' && req.url === '/run') {
    if (running) { res.writeHead(409); return res.end(JSON.stringify({ error: 'already running' })); }
    // --force omitted by design. The button is for the first run after a
    // recipe change, not for re-cutting pictures the manifest already has.
    running = spawn(process.execPath, ['gen-packs.mjs'], { cwd: process.cwd() });
    // cleared HERE, not only in /events: a run nobody streamed (the page reloaded
    // between the POST and the stream) used to leave every later POST at 409
    const child = running;
    child.on('exit', () => { if (running === child) running = null; });
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pid: running.pid }));
    // The actual progress stream is on GET /events - POST just kicks off.
    return;
  }

  if (req.method === 'GET' && req.url === '/events') {
    if (!running) { res.writeHead(409); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const child = running;
    let rest = '';   // a chunk can end mid-line; the tail waits for the next one
    const onData = (chunk) => {
      // gen-packs.mjs prints one line per booster in the form
      //   "i/total id outcome" or "i/total id skipped" or "i/total id failed: msg"
      // Emit each line as an SSE event the page can plot as the bar moves.
      const lines = (rest + chunk.toString()).split('\n');
      rest = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const m = /^(\d+)\/(\d+)\s+(\S+)\s+(.*)$/.exec(line);
        if (m) send(res, 'progress', { current: +m[1], total: +m[2], id: m[3], outcome: m[4] });
        else send(res, 'log', { line });
      }
    };
    const onErr = (c) => send(res, 'log', { line: c.toString().trimEnd() });
    const onExit = (code) => {
      if (rest.trim()) onData('\n');           // flush a last line with no newline
      send(res, 'done', { code });
      res.end();                               // the run is over; so is its stream
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onErr);
    child.on('exit', onExit);
    req.on('close', () => {
      child.stdout.off('data', onData); child.stderr.off('data', onErr); child.off('exit', onExit);
    });
    return;
  }

  // GET /status - the page polls this to decide whether to enable the button.
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ running: !!running }));
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  // The port is fixed and the message is the kind a user wants to see in the
  // terminal - what to open and how to stop it.
  console.log(`gen-packs server on http://localhost:${PORT}/`);
  console.log(`POST /run  GET /events  GET /status   (Ctrl-C to stop)`);
});
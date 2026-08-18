// Local server that runs gen-packs.mjs on demand and streams its stdout back
// over Server-Sent Events, so the Config page can show a live progress bar.
// The button on the page is a trigger + display, not a reimplementation - this
// file is the only piece of orchestration the page needs.
//
// Runs as `node gen-packs-server.mjs` and binds to localhost:5245. Spawned by
// the npm script "gen-packs" so the user only ever types one command.
// CORS is permissive on purpose: this is a localhost-only service with a fixed
// port, the page is the only caller, and the responses are read-only.
//
// State model: ONE concurrent run. POST /run while a run is in flight returns
// 409. The button in the page is disabled while a run is happening. Anything
// more is two-button UI for one process, which is what we are trying to avoid.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync, existsSync } from 'node:fs';

const PORT = 5245;
let running = null;       // child_process or null - tracks the one allowed run

const send = (res, event, data) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

const server = createServer((req, res) => {
  // CORS for the page. Same-origin would mean serving both from one port, which
  // would mean the page cannot be opened as a file - which it can, today. So
  // open CORS, localhost-only is the real guard.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'POST' && req.url === '/run') {
    if (running) { res.writeHead(409); return res.end(JSON.stringify({ error: 'already running' })); }
    // --force omitted by design. The button is for the first run after a
    // recipe change, not for re-cutting pictures the manifest already has.
    running = spawn(process.execPath, ['gen-packs.mjs'], { cwd: process.cwd() });
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pid: running.pid }));
    // The actual progress stream is on GET /events - POST just kicks off.
    return;
  }

  if (req.method === 'GET' && req.url === '/events') {
    if (!running) { res.writeHead(409); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const onData = (chunk) => {
      // gen-packs.mjs prints one line per booster in the form
      //   "i/total id outcome" or "i/total id skipped" or "i/total id failed: msg"
      // Emit each line as an SSE event the page can plot as the bar moves.
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        if (!line) continue;
        const m = /^(\d+)\/(\d+)\s+(\S+)\s+(.*)$/.exec(line);
        if (m) send(res, 'progress', { current: +m[1], total: +m[2], id: m[3], outcome: m[4] });
        else send(res, 'log', { line });
      }
    };
    const onExit = (code) => { send(res, 'done', { code }); running = null; };
    running.stdout.on('data', onData);
    running.stderr.on('data', (c) => send(res, 'log', { line: c.toString().trimEnd() }));
    running.on('exit', onExit);
    req.on('close', () => { running?.stdout.off('data', onData); });
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
"""Static server for the UI.  python serve.py  ->  http://localhost:5255/

ponytail: `python -m http.server 5255` plus two things.  The no-store header exists
because a cached index.html during iteration looks exactly like a broken page, and
chasing that once was enough.  The allow-list exists because this now roots at the
repo, so the default handler would happily serve .git/, data/ and any .env.
"""
import json
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ALLOWED = {'/', '/index.html', '/draft.css', '/sets.js', '/schema.js', '/trim.js', '/anatomy.js',
           '/mana.woff2', '/cards.json.gz'}

# Config's Local column used to be hand-typed strings -- "372 MB, pulled
# 2026-08-06 04:10" -- and every one of them had drifted: two named a file that
# was never downloaded, one named a filename that does not exist, and the sizes
# were months old.  A page cannot stat a disk, so it asked the only process that
# can.  This is deliberately live rather than a generated manifest: a manifest is
# a snapshot that goes stale the same way the typed strings did.
INVENTORY = '/data-index.json'


def _stat(p):
    s = p.stat()
    return {'bytes': s.st_size, 'mtime': int(s.st_mtime)}


def inventory():
    """What is actually on disk, for Config's Local column.

    Files are listed; the two directories that hold tens of thousands of images
    are COUNTED and grouped by the size in their name, because that is the only
    thing Config asks about them and a list of 107k paths is not a payload.
    """
    out = {'files': {}, 'groups': {}}
    for rel in ('mana.woff2', 'cards.json.gz', 'sets.js'):
        p = Path(rel)
        if p.is_file():
            out['files'][rel] = _stat(p)
    for p in sorted(Path('data').glob('*')):
        if p.is_file():
            out['files']['data/' + p.name] = _stat(p)

    def group(key, paths, name_of):
        for p in paths:
            if not p.is_file():
                continue
            g = out['groups'].setdefault(f'{key}/{name_of(p)}', {'n': 0, 'bytes': 0, 'mtime': 0})
            st = p.stat()
            g['n'] += 1
            g['bytes'] += st.st_size
            g['mtime'] = max(g['mtime'], int(st.st_mtime))

    # packs/<id>_<size>.png -- the size is the tail of the stem
    group('packs', Path('packs').glob('*.png'),
          lambda p: p.stem.split('_', 1)[1] if '_' in p.stem else '?')
    # art/sf/<size>/<side>/... and art/ptcg/<size>/... -- the size is the third part
    group('art', Path('art').glob('*/*/**/*'), lambda p: '/'.join(p.parts[1:3]))
    return out

# The collation is one file per set, fetched when you open that set's boosters --
# 181 files, so they are matched by shape rather than named one by one.  The
# pattern is deliberately tight: an uppercase set code and nothing else, so no
# separator, dot or slash can walk out of the directory.
#
# The underscore in the class is load-bearing: Conflux's code is CON, which
# Windows has reserved as a device name since DOS, so that one file is CON_.json.
# See packFile() in index.html and gen-boosters.mjs, which have to agree.
BOOSTER = re.compile(r'^/boosters/(?:index|[A-Z0-9_]{2,8})\.json$')

# Booster photographs, once `node gen-packs.mjs` has fetched and trimmed them --
# a TCGplayer product id and the size it was pulled at, which is what Config's
# Local/Online chip switches between.  Same tight shape as BOOSTER: digits and a
# known size only, so no separator, dot or slash can walk out of the directory.
PACK = re.compile(r'^/packs/\d{1,10}_(?:200w|in_1000x1000)\.png$')

# Card art, once `node gen-art.mjs` has fetched it -- the Local side of Config's
# Scryfall images row.  Same tight shape again: a known size, a known side, and
# the two shard characters and uuid that Scryfall's own CDN path uses, so no
# separator, dot or slash can walk out of the directory.
ART = re.compile(
    r'^/art/sf/(?:art_crop|small|normal|large|png)/(?:front|back)'
    r'/[0-9a-f]/[0-9a-f]/[0-9a-f-]{36}\.(?:jpg|png)$')

# Set symbols, once `node gen-symbols.mjs` has fetched them -- the Downloaded
# side of Config's Scryfall set symbols row.  This was the one local source with
# no rule at all, so all 335 files 404ed while sitting on disk: index.json on
# every page load, and every symbol the moment that row was switched off the CDN.
# Same tight shape as the others -- a lowercase icon name and nothing else, so no
# separator, dot or slash can walk out of the directory.  The bound is 16 rather
# than 8 because the fallbacks are spelled out (`planeswalker.svg`), and the
# trailing underscore is load-bearing for the same reason as BOOSTER's: Conflux's
# icon is `con`, which Windows reserves, so that file is `con_.svg`.
SYM = re.compile(r'^/sym/(?:index\.json|[a-z0-9_]{2,16}\.svg)$')


class NoCache(SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.path.split('?')[0]
        if path == INVENTORY:
            body = json.dumps(inventory()).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            from io import BytesIO
            return BytesIO(body)
        if (path not in ALLOWED and not BOOSTER.match(path)
                and not PACK.match(path) and not ART.match(path)
                and not SYM.match(path)):
            self.send_error(404)
            return None
        return super().send_head()

    # The catalogue is stored gzipped and served as-is.  The type has to be fixed
    # here rather than in end_headers: send_head() already emits a guessed
    # Content-Type, and adding a second one sends the header twice.
    def guess_type(self, path):
        if str(path).replace('\\', '/').endswith('/cards.json.gz'):
            return 'application/json'
        return super().guess_type(path)

    def end_headers(self):
        # Declaring the encoding is what lets the browser inflate it, so
        # fetch().json() works and the page needs no gunzip of its own.
        path = self.path.split('?')[0]
        if path == '/cards.json.gz':
            self.send_header('Content-Encoding', 'gzip')
            # max-age=86400 held a REGENERATED catalogue out of the page for a
            # day: gen-cards.mjs rewrites this file in place, so its name cannot
            # change with its contents the way an art URL's does, and the browser
            # had no reason to ask.  no-cache is not "do not cache", it is "ask
            # first" -- and send_head() already answers If-Modified-Since with a
            # 304, so an unchanged catalogue costs one empty round trip, not 7 MB.
            self.send_header('Cache-Control', 'no-cache')
        elif PACK.match(path) or ART.match(path):
            # a photograph keyed by product id and size cannot change without
            # changing its name, so re-fetching it on every reload is pure cost
            self.send_header('Cache-Control', 'max-age=86400')
        else:
            self.send_header('Cache-Control', 'no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
        super().end_headers()


class SoleServer(ThreadingHTTPServer):
    """Refuses to start if 5255 is already served.

    http.server's own `test()` sets allow_reuse_address, so a second
    `python serve.py` binds happily alongside the first and whichever process
    wins a given connection decides what the page gets.  Four instances
    accumulated that way once; the symptom was schema.js 404ing while plainly
    in ALLOWED, because ALLOWED is read at import and the winning process was
    running an older copy of this file.  Losing the reuse flag turns that
    silent shadowing into a refusal to start.
    """
    allow_reuse_address = False


if __name__ == '__main__':
    try:
        httpd = SoleServer(('127.0.0.1', 5255), NoCache)
    except OSError as exc:
        if exc.errno not in (98, 10048):        # EADDRINUSE (posix, win)
            raise
        sys.exit(
            'port 5255 is already served -- another serve.py is still running.\n'
            'It will keep answering with ITS copy of ALLOWED, so edits to this\n'
            'file stay invisible until every instance is gone.\n\n'
            '  Windows:  Get-NetTCPConnection -LocalPort 5255 | '
            'Select-Object OwningProcess\n'
            '            Stop-Process -Id <pid>\n'
            '  POSIX:    lsof -ti :5255 | xargs kill\n\n'
            'Re-run until it starts: killing one can surface another underneath.'
        )
    print('serving http://localhost:5255/  (Ctrl-C to stop)', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()

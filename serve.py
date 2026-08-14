"""Static server for the UI.  python serve.py  ->  http://localhost:5255/

ponytail: `python -m http.server 5255` plus two things.  The no-store header exists
because a cached index.html during iteration looks exactly like a broken page, and
chasing that once was enough.  The allow-list exists because this now roots at the
repo, so the default handler would happily serve .git/, data/ and any .env.
"""
import re
from http.server import SimpleHTTPRequestHandler, test

ALLOWED = {'/', '/index.html', '/draft.css', '/sets.js', '/mana.woff2', '/cards.json.gz'}

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


class NoCache(SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.path.split('?')[0]
        if path not in ALLOWED and not BOOSTER.match(path) and not PACK.match(path):
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
            # the one file worth caching: 5 MB re-fetched on every iteration
            # reload is the opposite of helpful
            self.send_header('Cache-Control', 'max-age=86400')
        elif PACK.match(path):
            # a photograph keyed by product id and size cannot change without
            # changing its name, so re-fetching it on every reload is pure cost
            self.send_header('Cache-Control', 'max-age=86400')
        else:
            self.send_header('Cache-Control', 'no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
        super().end_headers()


test(NoCache, port=5255, bind='127.0.0.1')

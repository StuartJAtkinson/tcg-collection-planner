import { NextResponse, type NextRequest } from 'next/server';

// Remembers the user's last-used filter choices as cookies so pages default to them next
// visit (instead of a fixed seeded default). When a tracked page is loaded WITH a filter
// param in the URL, that value is written to pref_<key>; the page reads pref_<key> when the
// param is absent. Seeded defaults live in the pages themselves as the final fallback.
const TRACKED: { test: (p: string) => boolean; keys: string[] }[] = [
  { test: (p) => p.startsWith('/g/'), keys: ['kind'] }, // Collections: remembered set-kind selection
  { test: (p) => p === '/search', keys: ['game'] }, // Search: remembered game scope
];

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const res = NextResponse.next();
  const YEAR = 60 * 60 * 24 * 365;
  for (const { test, keys } of TRACKED) {
    if (!test(pathname)) continue;
    for (const k of keys) {
      if (searchParams.has(k)) {
        res.cookies.set(`pref_${k}`, searchParams.get(k) ?? '', { path: '/', maxAge: YEAR });
      }
    }
  }
  return res;
}

export const config = { matcher: ['/g/:path*', '/search'] };

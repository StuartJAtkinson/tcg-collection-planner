import { NextRequest } from 'next/server';
import { search } from '../../../src/search.ts';

// Infinite-scroll paging endpoint for the Search page. Same query as the initial server render,
// just with an offset. Returns the next page of cards as JSON. Tri-state values ("+W", "-WU")
// peel off into plus/minus; bare values land in plus for backward compatibility.
function splitSigned(vs: string[]) {
  const plus: string[] = [], minus: string[] = [];
  for (const v of vs) {
    if (v.startsWith('+')) plus.push(v.slice(1));
    else if (v.startsWith('-')) minus.push(v.slice(1));
    else plus.push(v);
  }
  return { plus, minus };
}

export async function GET(req: NextRequest) {
  const s = req.nextUrl.searchParams;
  const combos = splitSigned(s.getAll('combo'));
  const kinds = splitSigned(s.getAll('kind'));
  const cards = await search({ type: 'all' }, s.get('q') ?? '', {
    game: s.get('game') ?? '',
    kindPlus: kinds.plus, kindMinus: kinds.minus,
    combosPlus: combos.plus, combosMinus: combos.minus,
    cmcMin: s.get('cmcMin') ?? '',
    cmcMax: s.get('cmcMax') ?? '',
    sort: s.get('sort') ?? '',
    offset: parseInt(s.get('offset') ?? '0', 10) || 0,
    limit: 60,
  });
  return Response.json(cards);
}

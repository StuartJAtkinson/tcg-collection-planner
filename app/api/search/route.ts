import { NextRequest } from 'next/server';
import { searchCards } from '../../../src/search.ts';

// Infinite-scroll paging endpoint for the Search page. Same query as the initial server render,
// just with an offset. Returns the next page of cards as JSON.
export async function GET(req: NextRequest) {
  const s = req.nextUrl.searchParams;
  const cards = await searchCards({
    q: s.get('q') ?? '',
    game: s.get('game') ?? '',
    kind: s.get('kind') ?? '',
    combos: s.getAll('combo'),
    cmcs: s.getAll('cmc'),
    sort: s.get('sort') ?? '',
    offset: parseInt(s.get('offset') ?? '0', 10) || 0,
    limit: 60,
  });
  return Response.json(cards);
}

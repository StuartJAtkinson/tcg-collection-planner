import { client } from '../db/index.ts';
import { tokenScore } from './csv.ts';

export type CandidateCard = {
  id: string; name: string; collector_number: string; rarity_raw: string | null;
  image_small: string | null; image_large: string | null; finishes: string[];
  attrs: Record<string, any> | null; game_id: string; set_code: string; set_name: string;
  release_date: string | null; colors: string[]; score: number;
};

const SELECT = client`
  select c.id, c.name, c.collector_number, c.rarity_raw, c.image_small, c.image_large,
         c.finishes, c.attrs, c.game_id, s.code as set_code, s.name as set_name, s.release_date,
         coalesce((select array_agg(f.value) from card_facets f where f.card_id = c.id and f.facet = 'color'), '{}') as colors
  from cards c join sets s on s.id = c.set_id`;

// exact case-insensitive name match first (covers "ambiguous" and correctly-spelled
// "not found in set" rows); broadens to an ILIKE scan only if that comes up short.
//
// A card resolved by exact name (e.g. "Terminate", 29 real printings) is NEVER truncated to
// `limit` — those printings genuinely differ (border colour, art, frame era) and the whole
// point of this tool is letting a human pick the right one visually, so all of them are
// returned and the page scrolls horizontally. Truncating by score here would be arbitrary:
// this query runs fresh on every page load with no ORDER BY tiebreaker among score ties, so
// "top N" isn't even stable across reloads — a card could visibly vanish and reappear for no
// reason. `limit` still caps the fuzzy/no-exact-match fallback, where relevance genuinely
// needs to filter a large field down to plausible candidates.
export async function findCandidates(
  name: string,
  setNameHint: string | undefined,
  gameHint: string | undefined,
  limit = 8,
): Promise<CandidateCard[]> {
  const exact = await client`${SELECT} where lower(c.name) = ${name.toLowerCase()} ${gameHint ? client`and c.game_id = ${gameHint}` : client``}`;

  let pool: CandidateCard[];
  if (exact.length) {
    pool = exact.map((r) => ({ ...r, score: 1 })) as CandidateCard[];
  } else {
    const needle = `%${name.slice(0, 24)}%`;
    const broader = await client`
      ${SELECT} where c.name ilike ${needle} ${gameHint ? client`and c.game_id = ${gameHint}` : client``} limit 300`;
    const scored = broader.map((r) => ({
      ...r,
      score: tokenScore(name, r.name) * 0.7 + (setNameHint ? tokenScore(setNameHint, r.set_name) * 0.3 : 0),
    })) as CandidateCard[];
    // deterministic tiebreak (id) so the same "top N" shows on every reload, not whatever
    // arbitrary order Postgres happened to return tied rows in
    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    pool = scored.slice(0, limit);
  }

  // display order is chronological (newest first) — a scanned collection skews toward
  // recently-bought/recently-printed cards
  pool.sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''));
  return pool;
}

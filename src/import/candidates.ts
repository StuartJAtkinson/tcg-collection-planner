import { client } from '../db/index.ts';
import { tokenScore } from './csv.ts';

export type CandidateCard = {
  id: string; name: string; collector_number: string; rarity_raw: string | null;
  image_small: string | null; image_large: string | null; finishes: string[];
  attrs: Record<string, any> | null; game_id: string; set_code: string; set_name: string;
  colors: string[]; score: number;
};

const SELECT = client`
  select c.id, c.name, c.collector_number, c.rarity_raw, c.image_small, c.image_large,
         c.finishes, c.attrs, c.game_id, s.code as set_code, s.name as set_name,
         coalesce((select array_agg(f.value) from card_facets f where f.card_id = c.id and f.facet = 'color'), '{}') as colors
  from cards c join sets s on s.id = c.set_id`;

// exact case-insensitive name match first (covers "ambiguous" and correctly-spelled
// "not found in set" rows); broadens to an ILIKE scan only if that comes up short.
export async function findCandidates(
  name: string,
  setNameHint: string | undefined,
  gameHint: string | undefined,
  limit = 5,
): Promise<CandidateCard[]> {
  const rows = await client`${SELECT} where lower(c.name) = ${name.toLowerCase()} ${gameHint ? client`and c.game_id = ${gameHint}` : client``}`;
  const seen = new Set(rows.map((r) => r.id));
  if (rows.length < limit * 4) {
    const needle = `%${name.slice(0, 24)}%`;
    const broader = await client`
      ${SELECT} where c.name ilike ${needle} ${gameHint ? client`and c.game_id = ${gameHint}` : client``} limit 300`;
    for (const r of broader) if (!seen.has(r.id)) { rows.push(r); seen.add(r.id); }
  }
  const scored = rows.map((r) => ({
    ...r,
    score: tokenScore(name, r.name) * 0.7 + (setNameHint ? tokenScore(setNameHint, r.set_name) * 0.3 : 0),
  })) as CandidateCard[];
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

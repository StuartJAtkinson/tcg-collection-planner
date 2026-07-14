'use server';

import { and, eq } from 'drizzle-orm';
import { db } from './db/index.ts';
import { holdings } from './db/schema.ts';

const USER = 'stuart';

// one holding row per (user, card, finish) — toggling adds/removes it.
// completion counts distinct owned card_id regardless of which finish, per the
// one-slot-per-card model: any variant satisfies the slot.
export async function toggleHolding(cardId: string, finish: string) {
  const where = and(eq(holdings.userId, USER), eq(holdings.cardId, cardId), eq(holdings.finish, finish));
  const [existing] = await db.select().from(holdings).where(where);
  if (existing) {
    await db.delete(holdings).where(where);
  } else {
    await db.insert(holdings).values({ userId: USER, cardId, finish });
  }
}

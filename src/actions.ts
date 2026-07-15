'use server';

import { and, eq } from 'drizzle-orm';
import { readFileSync, writeFileSync } from 'node:fs';
import { revalidatePath } from 'next/cache';
import { db, client } from './db/index.ts';
import { holdings } from './db/schema.ts';
import { money, normalizeGrade, parseCsv, pickFinish, portfolioToContainer } from './import/csv.ts';

const USER = 'stuart';

async function ensureContainer(c: { id: string; name: string; kind: string }): Promise<string> {
  await client`
    insert into containers (id, user_id, name, kind)
    values (${c.id}, ${USER}, ${c.name}, ${c.kind})
    on conflict (id) do nothing`;
  return c.id;
}

// one holding row per (user, card, finish, container) — the checklist toggle manages the
// 'main' collection pool only; deck rows are created by imports/resolve and untouched here.
// completion counts distinct owned card_id regardless of finish or container, per the
// one-slot-per-card model: any variant anywhere satisfies the slot.
export async function toggleHolding(cardId: string, finish: string) {
  await ensureContainer({ id: 'main', name: 'Main', kind: 'collection' });
  const where = and(
    eq(holdings.userId, USER),
    eq(holdings.cardId, cardId),
    eq(holdings.finish, finish),
    eq(holdings.containerId, 'main'),
  );
  const [existing] = await db.select().from(holdings).where(where);
  if (existing) {
    await db.delete(holdings).where(where);
  } else {
    await db.insert(holdings).values({ userId: USER, cardId, finish, containerId: 'main' });
  }
}

// applies picks made on /resolve: each `choice_<i>` field is a chosen card id (unselected rows
// submit nothing). Resolved rows are written as holdings, then dropped from the unmatched CSV
// so the file is self-cleaning — re-visiting /resolve shows only what's still unresolved.
export async function resolveImportRows(formData: FormData) {
  const filePath = String(formData.get('file') ?? '');
  if (!filePath) return;

  // rows are removed by absolute position in the file, never by matching content — two
  // physically-scanned duplicates can produce byte-identical CSV rows, and content-based
  // dedup would silently drop both when only one was resolved
  const resolvedIndices = new Set<number>();

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('choice_')) continue;
    const i = key.slice('choice_'.length);
    const choice = String(value);
    if (!choice) continue;

    const [card] = await client`select finishes from cards where id = ${choice}`;
    if (!card) continue;

    const variant = formData.get(`variant_${i}`)?.toString();
    const quantityRaw = formData.get(`quantity_${i}`)?.toString();
    const paidRaw = formData.get(`paid_${i}`)?.toString();
    const condition = formData.get(`condition_${i}`)?.toString() || null;
    const gradeRaw = formData.get(`grade_${i}`)?.toString();
    const gradingCompany = formData.get(`gradingCompany_${i}`)?.toString();
    const portfolio = formData.get(`portfolio_${i}`)?.toString();

    const finish = pickFinish(card.finishes, variant);
    const quantity = quantityRaw ? parseInt(quantityRaw, 10) || 1 : 1;
    const paid = paidRaw ? money(paidRaw) : null;
    const grade = normalizeGrade(gradeRaw, gradingCompany);
    const containerId = await ensureContainer(portfolioToContainer(portfolio));

    await client`
      insert into holdings (user_id, card_id, finish, container_id, quantity, condition, grade, paid)
      values (${USER}, ${choice}, ${finish}, ${containerId}, ${quantity}, ${condition}, ${grade}, ${paid})
      on conflict (user_id, card_id, finish, container_id)
      do update set quantity = holdings.quantity + excluded.quantity,
                     condition = coalesce(excluded.condition, holdings.condition),
                     grade = coalesce(excluded.grade, holdings.grade),
                     paid = coalesce(holdings.paid, excluded.paid)`;
    resolvedIndices.add(Number(i));
  }

  if (resolvedIndices.size) {
    const rows = parseCsv(readFileSync(filePath, 'utf8'));
    const [header, ...dataRows] = rows;
    const remaining = dataRows.filter((_, idx) => !resolvedIndices.has(idx));
    const esc = (f: string) => `"${String(f ?? '').replace(/"/g, '""')}"`;
    const out = [header, ...remaining].map((r) => r.map(esc).join(',')).join('\n');
    writeFileSync(filePath, out);
  }

  revalidatePath('/resolve');
}

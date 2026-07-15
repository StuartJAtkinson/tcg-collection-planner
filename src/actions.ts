'use server';

import { readFileSync, writeFileSync } from 'node:fs';
import { revalidatePath } from 'next/cache';
import { client } from './db/index.ts';
import { money, normalizeGrade, parseCsv, pickFinish, portfolioToContainer } from './import/csv.ts';

const USER = 'stuart';

async function ensureContainer(c: { id: string; name: string; kind: string }): Promise<string> {
  await client`
    insert into containers (id, user_id, name, kind)
    values (${c.id}, ${USER}, ${c.name}, ${c.kind})
    on conflict (id) do nothing`;
  return c.id;
}

// Import Locations: classify each imported container as a binder or a deck; anything left
// unselected is 'unsorted' (loose in the collection). The form submits a hidden `ids` list of
// every container so we can default the unselected ones to unsorted rather than leaving them
// as whatever the import guessed.
export async function setContainerKind(formData: FormData) {
  const ids = String(formData.get('ids') ?? '').split(',').filter(Boolean);
  for (const id of ids) {
    const chosen = formData.get(`kind_${id}`)?.toString();
    const kind = chosen === 'binder' || chosen === 'deck' ? chosen : 'unsorted';
    await client`update containers set kind = ${kind} where id = ${id} and user_id = ${USER}`;
  }
  revalidatePath('/binders');
  revalidatePath('/decks');
}

// Create Binders: materialize a suggested set-binder. Moves every owned holding of the set
// that is currently sitting in the unsorted pool into a new binder container. Cards already
// filed in decks or other binders are left where they are — this only files the loose ones.
export async function createSetBinder(formData: FormData) {
  const setId = String(formData.get('set_id') ?? '');
  const setName = String(formData.get('set_name') ?? 'Set');
  if (!setId) return;
  const binderId = `binder-${setId}`;
  await ensureContainer({ id: binderId, name: `${setName} binder`, kind: 'binder' });
  await client`
    update holdings h set container_id = ${binderId}
    from cards c
    where h.card_id = c.id and c.set_id = ${setId}
      and h.user_id = ${USER} and h.container_id = 'unsorted'`;
  revalidatePath('/binders');
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

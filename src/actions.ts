'use server';

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { client } from './db/index.ts';
import { money, normalizeGrade, pickFinish, portfolioToContainer } from './import/csv.ts';
import { runCollectrImport, type MatchedHolding, type StagedContainer } from './import/run.ts';

const USER = 'stuart';

// ponytail: local one-liner — slug derived from user-supplied names. Returns a short URL-safe
// id string; falls back to the kind when the name has no usable characters.
const slug = (name: string, fallback: string) =>
  name.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || fallback;

// a staged (not-yet-committed) import batch lives as a temp JSON file keyed by an opaque token
// in the URL. Nothing enters holdings until commitImport reads it; abandon the page and the
// file is simply never consumed — the import is dropped, not suspended.
// ponytail: temp-file staging, single local user; move to a table if this ever goes multi-user.
const stagePath = (token: string) => path.join(os.tmpdir(), `cc-import-${token.replace(/[^a-z0-9]/gi, '')}.json`);

async function ensureContainer(c: { id: string; name: string; kind: string }): Promise<string> {
  await client`
    insert into containers (id, user_id, name, kind)
    values (${c.id}, ${USER}, ${c.name}, ${c.kind})
    on conflict (id) do nothing`;
  return c.id;
}

// Run an import: parse + match the uploaded file (Collectr only for now), REPLACE the persistent
// unmatched set (so a re-exported/corrected file supersedes rather than duplicates), and STAGE
// the matched cards to a temp file. Nothing is committed to holdings here — we redirect to the
// locations step (/resolve?batch=…) where you confirm binder/deck and click Import.
export async function runImport(formData: FormData) {
  const source = String(formData.get('source') ?? 'collectr');
  const file = formData.get('file');
  if (source !== 'collectr' || !(file instanceof File) || file.size === 0) return;

  const { matched, unmatched, containers } = await runCollectrImport(await file.text());

  await client.begin(async (tx) => {
    await tx`delete from import_unmatched where user_id = ${USER}`;
    for (const u of unmatched) {
      await tx`insert into import_unmatched (user_id, fields, reason) values (${USER}, ${tx.json(u.fields)}, ${u.reason})`;
    }
  });

  const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  writeFileSync(stagePath(token), JSON.stringify({ matched, containers }));
  revalidatePath('/resolve');
  redirect(`/resolve?batch=${token}`);
}

// Commit a staged import: read the temp batch, create each portfolio container with the kind
// chosen on the locations form (a portfolio left with neither binder nor deck selected drops
// into the global unsorted pool), then write every matched card to its container. Deletes the
// stage file so the batch can't be committed twice.
export async function commitImport(formData: FormData) {
  const token = String(formData.get('batch') ?? '');
  if (!token) return;
  let stage: { matched: MatchedHolding[]; containers: StagedContainer[] };
  try { stage = JSON.parse(readFileSync(stagePath(token), 'utf8')); } catch { redirect('/resolve'); }

  const kindOf = (id: string) => {
    const chosen = formData.get(`kind_${id}`)?.toString();
    return chosen === 'binder' || chosen === 'deck' ? chosen : 'unsorted';
  };

  await client.begin(async (tx) => {
    for (const c of stage.containers) {
      const kind = kindOf(c.id);
      if (kind === 'unsorted') continue; // its cards route to the global pool below, no container
      await tx`insert into containers (id, user_id, name, kind) values (${c.id}, ${USER}, ${c.name}, ${kind})
               on conflict (id) do update set kind = excluded.kind`;
    }
    for (const m of stage.matched) {
      // if this card's portfolio was dropped to unsorted, redirect it into the global pool
      const containerId = m.container_id !== 'unsorted' && kindOf(m.container_id) === 'unsorted' ? 'unsorted' : m.container_id;
      await tx`insert into holdings (user_id, card_id, finish, container_id, quantity, condition, grade, paid)
               values (${USER}, ${m.card_id}, ${m.finish}, ${containerId}, ${m.quantity}, ${m.condition}, ${m.grade}, ${m.paid})
               on conflict (user_id, card_id, finish, container_id)
               do update set quantity = holdings.quantity + excluded.quantity,
                             condition = coalesce(excluded.condition, holdings.condition),
                             grade = coalesce(excluded.grade, holdings.grade),
                             paid = coalesce(holdings.paid, excluded.paid)`;
    }
  });
  try { unlinkSync(stagePath(token)); } catch { /* already gone */ }
  revalidatePath('/binders');
  revalidatePath('/decks');
  revalidatePath('/resolve');
  redirect('/binders');
}

// Discard a staged import without committing anything.
export async function discardImport(formData: FormData) {
  const token = String(formData.get('batch') ?? '');
  if (token) { try { unlinkSync(stagePath(token)); } catch { /* already gone */ } }
  redirect('/resolve');
}

// revalidate every surface a holding change can touch: both list pages and the specific
// container detail pages involved.
function revalidateContainers(...ids: string[]) {
  revalidatePath('/binders');
  revalidatePath('/decks');
  for (const id of ids) {
    revalidatePath(`/binders/${id}`);
    revalidatePath(`/decks/${id}`);
  }
}

// Manually add a catalogue card to a container (the write path Collections deliberately lacks).
// Finish defaults to the card's primary finish; quantity merges into any existing copy.
export async function addHolding(formData: FormData) {
  const containerId = String(formData.get('container_id') ?? '');
  const cardId = String(formData.get('card_id') ?? '');
  const quantity = Math.max(1, parseInt(String(formData.get('quantity') ?? '1'), 10) || 1);
  if (!containerId || !cardId) return;
  const [card] = await client`select finishes from cards where id = ${cardId}`;
  if (!card) return;
  const wanted = String(formData.get('finish') ?? '');
  const finish = wanted || card.finishes[0] || 'normal';
  await client`
    insert into holdings (user_id, card_id, finish, container_id, quantity)
    values (${USER}, ${cardId}, ${finish}, ${containerId}, ${quantity})
    on conflict (user_id, card_id, finish, container_id)
    do update set quantity = holdings.quantity + excluded.quantity`;
  revalidateContainers(containerId);
}

// Move a single holding (one card+finish) from one container to another, merging quantities
// into any copy already sitting in the destination.
export async function moveHolding(formData: FormData) {
  const cardId = String(formData.get('card_id') ?? '');
  const finish = String(formData.get('finish') ?? '');
  const from = String(formData.get('from') ?? '');
  const to = String(formData.get('to') ?? '');
  if (!cardId || !finish || !from || !to || from === to) return;
  await client.begin(async (tx) => {
    await tx`
      insert into holdings (user_id, card_id, finish, container_id, quantity, condition, grade, paid)
      select user_id, card_id, finish, ${to}, quantity, condition, grade, paid
      from holdings where user_id = ${USER} and card_id = ${cardId} and finish = ${finish} and container_id = ${from}
      on conflict (user_id, card_id, finish, container_id)
      do update set quantity = holdings.quantity + excluded.quantity`;
    await tx`delete from holdings where user_id = ${USER} and card_id = ${cardId} and finish = ${finish} and container_id = ${from}`;
  });
  revalidateContainers(from, to);
}

// Edit a single holding's quantity / condition / paid. Quantity ≤ 0 removes the row entirely
// (the way to take a card out of a container without moving it somewhere).
export async function updateHolding(formData: FormData) {
  const cardId = String(formData.get('card_id') ?? '');
  const finish = String(formData.get('finish') ?? '');
  const containerId = String(formData.get('container_id') ?? '');
  if (!cardId || !finish || !containerId) return;
  const quantity = parseInt(String(formData.get('quantity') ?? ''), 10);
  const condition = String(formData.get('condition') ?? '').trim() || null;
  const paidRaw = String(formData.get('paid') ?? '').trim();
  const paid = paidRaw ? money(paidRaw) : null;

  if (!Number.isFinite(quantity) || quantity <= 0) {
    await client`delete from holdings where user_id = ${USER} and card_id = ${cardId} and finish = ${finish} and container_id = ${containerId}`;
  } else {
    await client`
      update holdings set quantity = ${quantity}, condition = ${condition}, paid = ${paid}
      where user_id = ${USER} and card_id = ${cardId} and finish = ${finish} and container_id = ${containerId}`;
  }
  revalidateContainers(containerId);
}

// Rename a binder/deck from its detail page. The unsorted pool keeps its fixed name.
export async function renameContainer(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim().slice(0, 100);
  if (!id || id === 'unsorted' || !name) return;
  await client`update containers set name = ${name} where id = ${id} and user_id = ${USER}`;
  revalidatePath('/binders');
  revalidatePath('/decks');
  revalidatePath(`/binders/${id}`);
  revalidatePath(`/decks/${id}`);
}

// Delete a binder/deck container. mode 'keep' moves its holdings back to the unsorted pool
// (merging quantities where a copy already sits there); mode 'delete' removes the holdings
// outright. Either way the container is dropped. 'unsorted' can never be deleted.
export async function deleteContainer(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const mode = String(formData.get('mode') ?? 'keep');
  if (!id || id === 'unsorted') return;
  await client.begin(async (tx) => {
    if (mode === 'keep') {
      // move to unsorted, summing into any existing unsorted row for the same card+finish
      await tx`
        insert into holdings (user_id, card_id, finish, container_id, quantity, condition, grade, paid)
        select user_id, card_id, finish, 'unsorted', quantity, condition, grade, paid
        from holdings where container_id = ${id}
        on conflict (user_id, card_id, finish, container_id)
        do update set quantity = holdings.quantity + excluded.quantity`;
    }
    await tx`delete from holdings where container_id = ${id}`;
    await tx`delete from containers where id = ${id} and user_id = ${USER}`;
  });
  revalidatePath('/binders');
  revalidatePath('/decks');
}

// Create an empty binder or deck from the button at the top of /binders or /decks, then jump
// straight into it so you can start filling it. Name is required; id is a slug + short suffix so
// two binders called "Draft" don't collide.
export async function createContainer(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim().slice(0, 100);
  const kind = String(formData.get('kind')) === 'deck' ? 'deck' : 'binder';
  if (!name) return;
  const id = `${slug(name, kind)}-${Date.now().toString(36)}`;
  await client`insert into containers (id, user_id, name, kind) values (${id}, ${USER}, ${name}, ${kind})`;
  revalidatePath('/binders');
  revalidatePath('/decks');
  redirect(`/${kind === 'deck' ? 'decks' : 'binders'}/${id}`);
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

// Functional binder builder: the browser calculates and previews the exact order, including
// page-break gaps. The action treats that order as a request, not authority: only holdings
// currently in this user's unsorted pool can move, and every submitted card/finish pair is
// checked again inside the transaction before it receives a persisted binder position.
export async function createFunctionalBinder(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim().slice(0, 100);
  if (!name) return;
  const cols = Math.min(12, Math.max(1, Number(formData.get('cols')) || 3));
  const rows = Math.min(12, Math.max(1, Number(formData.get('rows')) || 3));

  let ordered: string[] = [];
  try {
    const parsedOrder = JSON.parse(String(formData.get('ordered') ?? '[]'));
    if (Array.isArray(parsedOrder)) ordered = parsedOrder.filter((v): v is string => typeof v === 'string');
  } catch {
    return;
  }
  if (!ordered.length) return;

  const binderId = `${slug(name, 'binder')}-${Date.now().toString(36)}`;

  await client.begin(async (tx) => {
    await tx`
      insert into containers (id, user_id, name, kind, pocket_cols, pocket_rows)
      values (${binderId}, ${USER}, ${name}, 'binder', ${cols}, ${rows})`;

    for (const item of ordered) {
      const [positionRaw, cardId, finish] = item.split('\t');
      const position = Number(positionRaw);
      if (!Number.isSafeInteger(position) || position < 0 || !cardId || !finish) continue;
      await tx`
        update holdings
        set container_id = ${binderId}, binder_position = ${position}
        where user_id = ${USER} and container_id = 'unsorted'
          and card_id = ${cardId} and finish = ${finish}`;
    }
  });

  revalidatePath('/binders');
  revalidatePath(`/binders/${binderId}`);
  redirect(`/binders/${binderId}`);
}

// applies picks made on /resolve: each `choice_<id>` field is a chosen card id for the
// import_unmatched row with that id (unselected rows submit nothing). A resolved row is written
// as a holding using the stored Collectr fields, then deleted from import_unmatched — so
// re-visiting /resolve shows only what's still unresolved.
export async function resolveImportRows(formData: FormData) {
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('choice_')) continue;
    const id = key.slice('choice_'.length);
    const choice = String(value);
    if (!choice) continue;

    const [card] = await client`select finishes from cards where id = ${choice}`;
    if (!card) continue;
    const [um] = await client`select fields from import_unmatched where id = ${id} and user_id = ${USER}`;
    if (!um) continue;
    const f = (um.fields ?? {}) as Record<string, string>;

    const finish = pickFinish(card.finishes, f.variant);
    const quantity = f.quantity ? parseInt(f.quantity, 10) || 1 : 1;
    const paid = f.purchasePrice ? money(f.purchasePrice) : null;
    const grade = normalizeGrade(f.grade, f.gradingCompany);
    const containerId = await ensureContainer(portfolioToContainer(f.portfolio));

    await client`
      insert into holdings (user_id, card_id, finish, container_id, quantity, condition, grade, paid)
      values (${USER}, ${choice}, ${finish}, ${containerId}, ${quantity}, ${f.condition || null}, ${grade}, ${paid})
      on conflict (user_id, card_id, finish, container_id)
      do update set quantity = holdings.quantity + excluded.quantity,
                     condition = coalesce(excluded.condition, holdings.condition),
                     grade = coalesce(excluded.grade, holdings.grade),
                     paid = coalesce(holdings.paid, excluded.paid)`;
    await client`delete from import_unmatched where id = ${id} and user_id = ${USER}`;
  }

  revalidatePath('/resolve');
  revalidatePath('/binders');
  revalidatePath('/decks');
}

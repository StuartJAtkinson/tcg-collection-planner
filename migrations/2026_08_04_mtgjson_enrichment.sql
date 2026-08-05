-- MTGJSON-primary refactor enrichment:
--   1. Eight new per-set fields MTGJSON uniquely carries
--   2. New mtg_card_printings table: one row per MTGJSON uuid (base/foil/promo/foreign),
--      FK-linked to cards.id so the per-Scryfall-card "primary" attrs row can sit alongside
--      every other printing of the same Scryfall card without losing finish/promo/lang data.
--
-- Both migrations are idempotent (IF NOT EXISTS / CREATE TABLE IF NOT EXISTS) so re-running
-- this file is safe. Drops are NOT included — these are additive only.

-- 1. Eight richer per-set fields
ALTER TABLE sets
  ADD COLUMN IF NOT EXISTS block_code text,
  ADD COLUMN IF NOT EXISTS parent_code text,
  ADD COLUMN IF NOT EXISTS mtgo_code text,
  ADD COLUMN IF NOT EXISTS arena_code text,
  ADD COLUMN IF NOT EXISTS is_foil_only boolean,
  ADD COLUMN IF NOT EXISTS is_online_only boolean,
  ADD COLUMN IF NOT EXISTS languages jsonb,
  ADD COLUMN IF NOT EXISTS translations jsonb;

-- 2. mtg_card_printings table
CREATE TABLE IF NOT EXISTS mtg_card_printings (
  card_id text NOT NULL REFERENCES cards(id),
  mtg_uuid text NOT NULL,
  lang text NOT NULL,
  finishes text[] NOT NULL,
  promo_types text[],
  is_reserved boolean,
  frame text,
  border_color text,
  security_stamp text,
  artist text,
  flavor_text text,
  PRIMARY KEY (card_id, mtg_uuid)
);
CREATE INDEX IF NOT EXISTS mtg_printings_lang_idx ON mtg_card_printings(lang);

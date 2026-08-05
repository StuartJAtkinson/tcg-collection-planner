-- Container model refactor:
--   1. containers gains filter jsonb + deck_source enum + source_sealed_id FK
--   2. sealed_products table for MTGJSON deck ingest (empty in v1)
--   3. One-shot binder conversion: derive containers.filter from current
--      holdings, then DROP those holdings (filter is the new source of truth).
--      sort_config is preserved untouched.
--
-- Idempotent. Safe to re-run; no-op when no binder holdings exist.

-- 1. containers schema additions
ALTER TABLE containers
  ADD COLUMN IF NOT EXISTS filter jsonb,
  ADD COLUMN IF NOT EXISTS deck_source text,
  ADD COLUMN IF NOT EXISTS source_sealed_id text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'containers_deck_source_chk') THEN
    ALTER TABLE containers
      ADD CONSTRAINT containers_deck_source_chk
      CHECK (deck_source IS NULL OR deck_source IN ('manual', 'sealed', 'scratch'));
  END IF;
END$$;

-- 2. sealed_products (empty in v1; populated by future MTGJSON ingest)
CREATE TABLE IF NOT EXISTS sealed_products (
  id text PRIMARY KEY,
  set_id text REFERENCES sets(id),
  set_code text NOT NULL,
  name text NOT NULL,
  type text,
  release_date date,
  main_board jsonb,
  side_board jsonb,
  commander jsonb,
  tokens jsonb,
  sealed_product_uuids text[],
  raw jsonb
);
CREATE INDEX IF NOT EXISTS sealed_products_set_idx ON sealed_products(set_id);
CREATE INDEX IF NOT EXISTS sealed_products_type_idx ON sealed_products(type);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'containers_source_sealed_fk') THEN
    ALTER TABLE containers
      ADD CONSTRAINT containers_source_sealed_fk
      FOREIGN KEY (source_sealed_id) REFERENCES sealed_products(id);
  END IF;
END$$;

-- 3. Binder conversion. Derive a filter expression per binder from the
--    distinct set_ids / rarities / color_combos / cmcs currently held, then
--    delete the holdings rows. No-op when no binder holdings exist.

CREATE TEMP TABLE _binder_filter_plan AS
WITH card_aggs AS (
  SELECT h.container_id,
         array_agg(DISTINCT c.set_id ORDER BY c.set_id) AS set_ids,
         array_agg(DISTINCT c.rarity_raw ORDER BY c.rarity_raw)
           FILTER (WHERE c.rarity_raw IS NOT NULL) AS rarities,
         array_agg(DISTINCT cf.value ORDER BY cf.value)
           FILTER (WHERE cf.facet = 'color_combo') AS color_combos,
         array_agg(DISTINCT c.attrs->>'cmc') AS cmcs,
         count(DISTINCT c.id) AS distinct_cards
  FROM holdings h
  JOIN cards c ON c.id = h.card_id
  LEFT JOIN card_facets cf
    ON cf.card_id = c.id AND cf.facet = 'color_combo'
  WHERE EXISTS (SELECT 1 FROM containers ct
                WHERE ct.id = h.container_id AND ct.kind = 'binder')
  GROUP BY h.container_id
)
SELECT b.id AS container_id,
       jsonb_build_object(
         'set_ids',      a.set_ids,
         'rarities',     a.rarities,
         'color_combos', a.color_combos,
         'cmcs',         a.cmcs
       ) AS filter
FROM containers b
JOIN card_aggs a ON a.container_id = b.id
WHERE b.kind = 'binder';

UPDATE containers c
SET filter = p.filter
FROM _binder_filter_plan p
WHERE c.id = p.container_id;

DELETE FROM holdings
WHERE container_id IN (SELECT id FROM containers WHERE kind = 'binder');

DROP TABLE _binder_filter_plan;
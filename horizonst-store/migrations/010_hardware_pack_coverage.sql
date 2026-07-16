ALTER TABLE store.packs
  ADD COLUMN IF NOT EXISTS coverage_square_meters INTEGER;

UPDATE store.packs
SET coverage_square_meters = CASE code
  WHEN 'starter' THEN 500
  WHEN 'professional' THEN 1000
  WHEN 'enterprise' THEN 2000
  ELSE coverage_square_meters
END,
updated_at = now()
WHERE code IN ('starter', 'professional', 'enterprise');

ALTER TABLE store.packs
  DROP CONSTRAINT IF EXISTS packs_coverage_square_meters_check;
ALTER TABLE store.packs
  ADD CONSTRAINT packs_coverage_square_meters_check
  CHECK (coverage_square_meters IS NULL OR coverage_square_meters > 0);

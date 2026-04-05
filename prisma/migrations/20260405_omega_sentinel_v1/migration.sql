-- ╔══════════════════════════════════════════════════════════════════╗
-- ║   OMEGA SENTINEL v1 MIGRATION  ·  2026-04-05                   ║
-- ╠══════════════════════════════════════════════════════════════════╣
-- ║  Adds newsSentinelWeight to SystemNeuroPlasticity singleton     ║
-- ║  (8th Expert — News Sentinel Phase 3).                         ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- Add newsSentinelWeight column (default 1.0, matches other expert weights)
ALTER TABLE "SystemNeuroPlasticity"
  ADD COLUMN IF NOT EXISTS "newsSentinelWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

-- Back-fill existing rows (should be just id=1 singleton)
UPDATE "SystemNeuroPlasticity"
  SET "newsSentinelWeight" = 1.0
  WHERE "newsSentinelWeight" IS NULL;

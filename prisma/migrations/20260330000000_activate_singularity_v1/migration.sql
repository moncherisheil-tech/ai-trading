-- ============================================================================
-- Migration: activate_singularity_v1
-- Description: Activate the 7-Expert Singularity Board.
--   1. Rename board_meeting_logs.the_6_expert_verdicts
--          → board_meeting_logs.the_7_expert_verdicts
--      (Expert 7 / Contrarian is now a full weighted contributor.)
--   2. Ensure SystemNeuroPlasticity row id=1 exists with contrarianWeight default.
--      (Upsert-safe: no-op if row already exists from a previous RL run.)
-- ============================================================================

-- 1. Board meeting logs: rename the verdicts column to reflect 7 experts.
--    Using IF EXISTS guard so re-running the migration does not fail.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'board_meeting_logs'
      AND column_name = 'the_6_expert_verdicts'
  ) THEN
    ALTER TABLE board_meeting_logs
      RENAME COLUMN the_6_expert_verdicts TO the_7_expert_verdicts;
  END IF;
END;
$$;

-- 2. Ensure SystemNeuroPlasticity singleton row (id=1) is seeded.
--    All 7 expert weights default to 1.0 (equal contribution baseline).
--    The SingularityEngine will update these after the first RL post-mortem run.
INSERT INTO "SystemNeuroPlasticity" (
  id,
  "techWeight",
  "riskWeight",
  "psychWeight",
  "macroWeight",
  "onchainWeight",
  "deepMemoryWeight",
  "contrarianWeight",
  "ceoConfidenceThreshold",
  "ceoRiskTolerance",
  "robotSlBufferPct",
  "robotTpAggressiveness",
  "updatedAt"
)
VALUES (
  1,
  1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
  75.0,
  1.0,
  2.0,
  1.0,
  NOW()
)
ON CONFLICT (id) DO NOTHING;

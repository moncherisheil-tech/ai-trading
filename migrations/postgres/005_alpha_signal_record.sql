-- Tri-Core Alpha Matrix: persisted signals + optional FK from TradeExecution (idempotent fragments).

DO $$ BEGIN
  CREATE TYPE "AlphaTimeframe" AS ENUM ('Hourly', 'Daily', 'Weekly', 'Long');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AlphaDirection" AS ENUM ('Long', 'Short');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AlphaSignalStatus" AS ENUM ('Active', 'Hit', 'Stopped', 'Expired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AlphaSignalRecord" (
  "id" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "timeframe" "AlphaTimeframe" NOT NULL,
  "direction" "AlphaDirection" NOT NULL,
  "entryPrice" DECIMAL(24, 8) NOT NULL,
  "targetPrice" DECIMAL(24, 8) NOT NULL,
  "stopLoss" DECIMAL(24, 8) NOT NULL,
  "winProbability" INTEGER NOT NULL,
  "whaleConfirmation" BOOLEAN NOT NULL DEFAULT false,
  "rationaleHebrew" TEXT NOT NULL,
  "status" "AlphaSignalStatus" NOT NULL DEFAULT 'Active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlphaSignalRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AlphaSignalRecord_status_createdAt_idx"
  ON "AlphaSignalRecord" ("status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AlphaSignalRecord_symbol_timeframe_status_idx"
  ON "AlphaSignalRecord" ("symbol", "timeframe", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TradeExecution_alphaSignalId_fkey'
  ) THEN
    ALTER TABLE "TradeExecution"
      ADD CONSTRAINT "TradeExecution_alphaSignalId_fkey"
      FOREIGN KEY ("alphaSignalId") REFERENCES "AlphaSignalRecord"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
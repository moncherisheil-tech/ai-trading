-- App settings (Master Command Center): key-value store for app_settings JSON.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- System settings (scanner on/off, last scan timestamp). Singleton row id=1.
CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  scanner_is_active BOOLEAN NOT NULL DEFAULT true,
  last_scan_timestamp BIGINT,
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO system_settings (id, scanner_is_active)
VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

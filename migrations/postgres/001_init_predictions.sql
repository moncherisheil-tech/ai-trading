CREATE TABLE IF NOT EXISTS prediction_records (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL,
  prediction_date TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prediction_records_symbol ON prediction_records(symbol);
CREATE INDEX IF NOT EXISTS idx_prediction_records_status ON prediction_records(status);
CREATE INDEX IF NOT EXISTS idx_prediction_records_prediction_date ON prediction_records(prediction_date DESC);

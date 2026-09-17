-- Migración aditiva; no altera usuarios, hardware ni histórico operativo.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_key TEXT PRIMARY KEY CHECK (bucket_key ~ '^[a-f0-9]{64}$'),
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_expiry_idx ON auth_rate_limits (expires_at);
COMMENT ON TABLE auth_rate_limits IS 'Presupuestos compartidos para autenticación; claves SHA-256, sin credenciales ni datos operativos.';

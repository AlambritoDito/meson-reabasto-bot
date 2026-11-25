-- Esquema de la demo. Todo dato de usuario está indexado por chat_id. No se guarda nombre, username ni teléfono.
CREATE TABLE IF NOT EXISTS updates (
  update_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  chat_id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  adjustments_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  approved_version INTEGER,
  pending_adjust_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_chat ON history (chat_id, id);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

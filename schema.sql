-- ユーザー投稿の喫煙所と、閉鎖・誤り報告
CREATE TABLE IF NOT EXISTS spots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('outdoor', 'indoor', 'shop')),
  heated_only INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  client_hash TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS spots_latlng ON spots (lat, lng);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL,            -- 'osm:node/123' または 'user:45'
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('closed', 'wrong')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  client_hash TEXT NOT NULL,
  UNIQUE (ref, client_hash)
);
CREATE INDEX IF NOT EXISTS reports_latlng ON reports (lat, lng);

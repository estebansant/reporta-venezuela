CREATE TABLE satellite_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  suggested_damage_type TEXT NOT NULL CHECK(suggested_damage_type IN ('cracks', 'moderate', 'severe', 'collapse')),
  score REAL,
  chip_r2_key TEXT,
  chip_report_id TEXT,
  chip_image_id TEXT,
  chip_width INTEGER,
  chip_height INTEGER,
  chip_size_bytes INTEGER,
  source_name TEXT NOT NULL,
  source_id TEXT NOT NULL,
  state TEXT,
  city TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE UNIQUE INDEX idx_candidates_source_unique ON satellite_candidates(source_name, source_id);
CREATE INDEX idx_candidates_status ON satellite_candidates(status, created_at DESC);

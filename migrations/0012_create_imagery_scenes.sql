CREATE TABLE imagery_scenes (
  scene_id      TEXT PRIMARY KEY,
  collection    TEXT,
  provider      TEXT NOT NULL,
  license       TEXT,
  phase         TEXT CHECK(phase IN ('pre','post')),
  datetime      TEXT,
  min_lat REAL, max_lat REAL, min_lng REAL, max_lng REAL,
  cloud_cover   REAL,
  crs           TEXT,
  resolution_m  REAL,
  r2_key        TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_imagery_scenes_bbox ON imagery_scenes (min_lat, max_lat, min_lng, max_lng);
CREATE INDEX idx_imagery_scenes_phase ON imagery_scenes (phase, datetime);

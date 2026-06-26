CREATE TABLE damage_zones (
  id TEXT PRIMARY KEY NOT NULL,
  geometry TEXT NOT NULL,
  min_lat REAL NOT NULL,
  max_lat REAL NOT NULL,
  min_lng REAL NOT NULL,
  max_lng REAL NOT NULL,
  centroid_lat REAL NOT NULL,
  centroid_lng REAL NOT NULL,
  damage_category TEXT NOT NULL CHECK(damage_category IN ('low', 'moderate', 'high', 'severe')),
  score REAL NOT NULL CHECK(score BETWEEN 0 AND 1),
  source_name TEXT NOT NULL,
  source_id TEXT NOT NULL,
  acquired_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_damage_zones_bbox ON damage_zones(min_lat, max_lat, min_lng, max_lng);
CREATE UNIQUE INDEX idx_damage_zones_source_unique ON damage_zones(source_name, source_id);

PRAGMA foreign_keys = ON;

CREATE TABLE reports (
  id TEXT PRIMARY KEY NOT NULL,
  building_name TEXT NOT NULL CHECK(length(building_name) BETWEEN 2 AND 120),
  address TEXT NOT NULL CHECK(length(address) BETWEEN 5 AND 240),
  state TEXT NOT NULL,
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  damage_type TEXT NOT NULL CHECK(damage_type IN ('cracks', 'moderate', 'severe', 'collapse')),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 10 AND 2000),
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  contact_consent INTEGER NOT NULL DEFAULT 0 CHECK(contact_consent IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'hidden')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE report_images (
  id TEXT PRIMARY KEY NOT NULL,
  report_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK(mime_type = 'image/webp'),
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 2097152),
  width INTEGER NOT NULL CHECK(width > 0 AND width <= 1920),
  height INTEGER NOT NULL CHECK(height > 0 AND height <= 1920),
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 4),
  created_at TEXT NOT NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE(report_id, position)
);

CREATE INDEX idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX idx_reports_state ON reports(state);
CREATE INDEX idx_reports_damage_type ON reports(damage_type);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_coordinates ON reports(latitude, longitude);
CREATE INDEX idx_report_images_report_id ON report_images(report_id, position);

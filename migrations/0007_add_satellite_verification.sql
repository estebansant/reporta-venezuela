ALTER TABLE reports ADD COLUMN verified_by_satellite INTEGER NOT NULL DEFAULT 0
  CHECK(verified_by_satellite IN (0, 1));
ALTER TABLE reports ADD COLUMN verified_at TEXT;
ALTER TABLE reports ADD COLUMN verified_source TEXT;
ALTER TABLE reports ADD COLUMN verified_source_id TEXT;

CREATE INDEX idx_reports_published_verified
  ON reports(verified_by_satellite, created_at DESC)
  WHERE status = 'published';

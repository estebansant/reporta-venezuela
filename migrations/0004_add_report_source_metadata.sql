ALTER TABLE reports
ADD COLUMN source_name TEXT;

ALTER TABLE reports
ADD COLUMN source_id TEXT;

ALTER TABLE reports
ADD COLUMN source_url TEXT;

ALTER TABLE reports
ADD COLUMN source_updated_at TEXT;

CREATE UNIQUE INDEX idx_reports_source_unique
ON reports(source_name, source_id)
WHERE source_name IS NOT NULL AND source_id IS NOT NULL;

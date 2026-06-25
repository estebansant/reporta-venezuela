ALTER TABLE reports
ADD COLUMN needs_help INTEGER NOT NULL DEFAULT 0 CHECK(needs_help IN (0, 1));

CREATE INDEX idx_reports_needs_help ON reports(needs_help);

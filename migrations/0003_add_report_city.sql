ALTER TABLE reports
ADD COLUMN city TEXT NOT NULL DEFAULT '' CHECK(length(city) <= 120);

CREATE INDEX idx_reports_city ON reports(city);

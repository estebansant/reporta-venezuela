ALTER TABLE reports ADD COLUMN building_id TEXT;
ALTER TABLE reports ADD COLUMN building_source TEXT;

CREATE INDEX IF NOT EXISTS idx_reports_building_id
  ON reports(building_id)
  WHERE building_id IS NOT NULL;

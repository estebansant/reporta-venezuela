CREATE INDEX idx_reports_published_state_map_recent
ON reports(state, latitude, longitude, created_at DESC)
WHERE status = 'published';

CREATE INDEX idx_reports_published_damage_map_recent
ON reports(damage_type, latitude, longitude, created_at DESC)
WHERE status = 'published';

CREATE INDEX idx_reports_published_verified_map_recent
ON reports(verified_by_satellite, latitude, longitude, created_at DESC)
WHERE status = 'published';

CREATE INDEX idx_reports_published_state_damage_recent
ON reports(state, damage_type, created_at DESC)
WHERE status = 'published';

CREATE INDEX idx_reports_published_state_verified_recent
ON reports(state, verified_by_satellite, created_at DESC)
WHERE status = 'published';

CREATE INDEX idx_report_images_covering_report_position
ON report_images(report_id, position, id, width, height);

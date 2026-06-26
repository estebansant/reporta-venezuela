CREATE INDEX idx_reports_published_created_at
ON reports(created_at DESC)
WHERE status = 'published';

CREATE INDEX idx_reports_published_state_created_at
ON reports(state, created_at DESC)
WHERE status = 'published';

CREATE INDEX idx_reports_published_damage_created_at
ON reports(damage_type, created_at DESC)
WHERE status = 'published';

CREATE INDEX idx_reports_published_viewport_created_at
ON reports(latitude, longitude, created_at DESC)
WHERE status = 'published';

CREATE INDEX idx_reports_published_needs_help
ON reports(needs_help, updated_at)
WHERE status = 'published';

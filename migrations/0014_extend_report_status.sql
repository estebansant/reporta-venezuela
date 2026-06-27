ALTER TABLE reports ADD COLUMN review_status TEXT NOT NULL DEFAULT 'reported'
  CHECK(review_status IN (
    'reported',
    'triaged_by_satellite',
    'externally_corroborated',
    'verified_collapsed',
    'verified_damaged',
    'rejected_unclear'
  ));

CREATE INDEX IF NOT EXISTS idx_reports_review_status
  ON reports(review_status, created_at DESC)
  WHERE status = 'published';

CREATE TABLE verification_evidence (
  id            TEXT PRIMARY KEY,
  report_id     TEXT NOT NULL,
  source_name   TEXT NOT NULL,
  source_id     TEXT,
  evidence_type TEXT,
  chip_r2_key   TEXT,
  scene_id      TEXT,
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_verification_evidence_report ON verification_evidence (report_id);

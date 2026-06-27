ALTER TABLE satellite_candidates ADD COLUMN vhr_scene_id TEXT;
ALTER TABLE satellite_candidates ADD COLUMN vhr_r2_key TEXT;

CREATE INDEX IF NOT EXISTS idx_candidates_vhr_scene
  ON satellite_candidates(vhr_scene_id)
  WHERE vhr_scene_id IS NOT NULL;

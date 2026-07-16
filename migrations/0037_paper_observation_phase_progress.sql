ALTER TABLE paper_observation_profile_runs
  ADD COLUMN phase TEXT NOT NULL DEFAULT 'queued';

ALTER TABLE paper_observation_profile_runs
  ADD COLUMN phase_started_at TEXT;

ALTER TABLE paper_observation_profile_runs
  ADD COLUMN phase_finished_at TEXT;

ALTER TABLE paper_observation_profile_runs
  ADD COLUMN heartbeat_at TEXT;

ALTER TABLE paper_observation_profile_runs
  ADD COLUMN phase_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE paper_observation_profile_runs
  ADD COLUMN phase_error_category TEXT;

ALTER TABLE paper_observation_profile_runs
  ADD COLUMN phase_error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_paper_observation_profile_runs_phase
  ON paper_observation_profile_runs(parent_run_id, status, phase, heartbeat_at);

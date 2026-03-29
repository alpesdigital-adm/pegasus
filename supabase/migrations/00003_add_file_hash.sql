-- Add file_hash column to surveys for duplicate detection
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS file_hash TEXT;

-- Index for fast duplicate lookups within a cohort
CREATE INDEX IF NOT EXISTS idx_surveys_cohort_hash ON surveys (cohort_id, file_hash);

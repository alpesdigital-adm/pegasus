-- Classification overrides: stores user corrections to auto-classification
-- so future files with the same column header use the corrected type/category.
CREATE TABLE classification_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  normalized_header TEXT NOT NULL,
  column_type TEXT NOT NULL CHECK (column_type IN (
    'identifier_email', 'identifier_name', 'identifier_phone', 'identifier_doc', 'identifier_social',
    'utm', 'metadata_timestamp', 'metadata_system', 'noise',
    'closed_multiple_choice', 'closed_scale', 'closed_range', 'closed_binary', 'closed_checkbox_group',
    'semi_closed', 'open'
  )),
  semantic_category TEXT CHECK (semantic_category IN (
    'qualification', 'professional_profile', 'revenue_current', 'revenue_desired',
    'pain_challenge', 'desire_goal', 'purchase_intent', 'purchase_decision', 'purchase_objection',
    'experience_time', 'how_discovered', 'feedback', 'hypothetical', 'content_request',
    'personal_data', 'investment_willingness', 'engagement_checklist'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cohort_id, normalized_header)
);

-- RLS
ALTER TABLE classification_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "classification_overrides_org_access" ON classification_overrides
  FOR ALL TO authenticated
  USING (
    cohort_id IN (
      SELECT c.id FROM cohorts c
      JOIN products p ON c.product_id = p.id
      WHERE p.org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    cohort_id IN (
      SELECT c.id FROM cohorts c
      JOIN products p ON c.product_id = p.id
      WHERE p.org_id = get_user_org_id()
    )
  );

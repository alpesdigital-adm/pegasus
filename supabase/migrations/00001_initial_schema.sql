-- ============================================================
-- Pegasus — Initial Schema Migration
-- All 21 tables from PRD v1
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- 1. ORGANIZATIONS
-- ============================================================
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'scale')),
  plan_limits JSONB NOT NULL DEFAULT '{"max_products": 1, "max_respondents": 5000, "max_users": 2}'::jsonb,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. USERS
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'admin', 'traffic_manager', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- 3. PRODUCTS
-- ============================================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  expert_name TEXT,
  slug TEXT NOT NULL,
  description TEXT,
  icp_qualifier_field TEXT,
  staff_names TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, slug)
);

CREATE INDEX idx_products_org ON products(org_id);

-- ============================================================
-- 4. COHORTS
-- ============================================================
CREATE TABLE cohorts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT CHECK (type IN ('launch', 'evergreen', 'live_event')),
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'capturing', 'live', 'selling', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, slug)
);

CREATE INDEX idx_cohorts_product ON cohorts(product_id);

-- ============================================================
-- 5. SURVEYS
-- ============================================================
CREATE TABLE surveys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  survey_type TEXT NOT NULL CHECK (survey_type IN ('captacao', 'pre_venda', 'engajamento', 'pos_venda', 'feedback', 'onboarding')),
  source_platform TEXT CHECK (source_platform IN ('typeform', 'google_forms', 'other')),
  total_rows INTEGER,
  processed_rows INTEGER,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'classifying', 'classified', 'processing', 'done', 'error')),
  error_message TEXT,
  classification_result JSONB,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_surveys_cohort ON surveys(cohort_id);

-- ============================================================
-- 6. SURVEY_COLUMNS
-- ============================================================
CREATE TABLE survey_columns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  column_index INTEGER NOT NULL,
  original_header TEXT NOT NULL,
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
  checkbox_group_name TEXT,
  detected_options JSONB,
  stats JSONB,
  include_in_analysis BOOLEAN NOT NULL DEFAULT TRUE,
  user_override BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_survey_columns_survey ON survey_columns(survey_id);

-- ============================================================
-- 7. RESPONDENTS
-- ============================================================
CREATE TABLE respondents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  document_id TEXT,
  social_handle TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  is_buyer BOOLEAN NOT NULL DEFAULT FALSE,
  buyer_product TEXT,
  buyer_date DATE,
  icp_score NUMERIC,
  icp_score_details JSONB,
  temperature TEXT CHECK (temperature IN ('cold', 'warm', 'hot')),
  stage TEXT,
  surveys_responded INTEGER DEFAULT 0,
  interactions_count INTEGER DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cohort_id, email)
);

CREATE INDEX idx_respondents_cohort ON respondents(cohort_id);
CREATE INDEX idx_respondents_email ON respondents(email);
CREATE INDEX idx_respondents_icp_score ON respondents(icp_score);

-- ============================================================
-- 8. IDENTITY_ALIASES
-- ============================================================
CREATE TABLE identity_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  alias_type TEXT NOT NULL CHECK (alias_type IN ('email', 'phone', 'display_name', 'chat_name', 'social')),
  alias_value TEXT NOT NULL,
  alias_raw TEXT,
  confidence NUMERIC NOT NULL DEFAULT 1.0,
  source TEXT,
  confirmed_by TEXT NOT NULL DEFAULT 'auto' CHECK (confirmed_by IN ('auto', 'manual', 'llm')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(alias_type, alias_value)
);

CREATE INDEX idx_identity_aliases_respondent ON identity_aliases(respondent_id);
CREATE INDEX idx_identity_aliases_value ON identity_aliases(alias_value);

-- ============================================================
-- 9. RESPONDENT_ANSWERS_CLOSED
-- ============================================================
CREATE TABLE respondent_answers_closed (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  column_id UUID NOT NULL REFERENCES survey_columns(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  numeric_value NUMERIC,
  numeric_range_min NUMERIC,
  numeric_range_max NUMERIC,
  checkbox_group_values TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_answers_closed_respondent ON respondent_answers_closed(respondent_id);
CREATE INDEX idx_answers_closed_column ON respondent_answers_closed(column_id);
CREATE INDEX idx_answers_closed_survey ON respondent_answers_closed(survey_id);
CREATE INDEX idx_answers_closed_value ON respondent_answers_closed(value);

-- ============================================================
-- 10. RESPONDENT_ANSWERS_OPEN
-- ============================================================
CREATE TABLE respondent_answers_open (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  column_id UUID NOT NULL REFERENCES survey_columns(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  semantic_category TEXT,
  embedding vector(1536),
  embedding_input TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_answers_open_respondent ON respondent_answers_open(respondent_id);
CREATE INDEX idx_answers_open_column ON respondent_answers_open(column_id);
CREATE INDEX idx_answers_open_category ON respondent_answers_open(semantic_category);

-- ============================================================
-- 11. RESPONDENT_UTM_SOURCES
-- ============================================================
CREATE TABLE respondent_utm_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  utm_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_utm_respondent ON respondent_utm_sources(respondent_id);
CREATE INDEX idx_utm_campaign ON respondent_utm_sources(utm_campaign);

-- ============================================================
-- 12. INTERACTIONS
-- ============================================================
CREATE TABLE interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  respondent_id UUID REFERENCES respondents(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('zoom_chat_v1', 'zoom_chat_v2', 'vtt_transcript', 'fathom_transcript', 'whatsapp', 'testimony')),
  source_file TEXT NOT NULL,
  source_event TEXT,
  display_name TEXT,
  timestamp_offset TEXT,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('message', 'reaction', 'reply', 'speech', 'testimony')),
  semantic_tag TEXT CHECK (semantic_tag IN ('pain', 'desire', 'objection', 'decision', 'insight', 'testimony', 'engagement', 'question', 'noise')),
  is_staff BOOLEAN NOT NULL DEFAULT FALSE,
  is_substantive BOOLEAN NOT NULL DEFAULT TRUE,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interactions_cohort ON interactions(cohort_id);
CREATE INDEX idx_interactions_respondent ON interactions(respondent_id);
CREATE INDEX idx_interactions_source ON interactions(source_type);
CREATE INDEX idx_interactions_tag ON interactions(semantic_tag);

-- ============================================================
-- 13. AD_METRICS
-- ============================================================
CREATE TABLE ad_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('meta', 'google', 'tiktok')),
  campaign_name TEXT NOT NULL,
  adset_name TEXT,
  ad_name TEXT,
  ad_id TEXT,
  date DATE NOT NULL,
  spend NUMERIC NOT NULL DEFAULT 0,
  impressions INTEGER,
  reach INTEGER,
  clicks INTEGER,
  landing_page_views INTEGER,
  leads_platform INTEGER,
  cpm NUMERIC,
  cpc NUMERIC,
  ctr NUMERIC,
  source_type TEXT NOT NULL CHECK (source_type IN ('csv_upload', 'api_sync')),
  source_file TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ad_metrics_cohort ON ad_metrics(cohort_id);
CREATE INDEX idx_ad_metrics_platform ON ad_metrics(platform);
CREATE INDEX idx_ad_metrics_campaign ON ad_metrics(campaign_name);
CREATE INDEX idx_ad_metrics_adset ON ad_metrics(adset_name);
CREATE INDEX idx_ad_metrics_ad ON ad_metrics(ad_name);
CREATE INDEX idx_ad_metrics_date ON ad_metrics(date);

-- ============================================================
-- 14. AD_CREATIVES
-- ============================================================
CREATE TABLE ad_creatives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  ad_name TEXT NOT NULL,
  ad_id TEXT,
  creative_type TEXT NOT NULL CHECK (creative_type IN ('video_transcript', 'copy_text', 'image_description')),
  content TEXT NOT NULL,
  hooks JSONB,
  angles JSONB,
  promises JSONB,
  embedding vector(1536),
  performance_summary JSONB,
  analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ad_creatives_cohort ON ad_creatives(cohort_id);
CREATE INDEX idx_ad_creatives_ad ON ad_creatives(ad_name);

-- ============================================================
-- 15. CONTENT_ANALYSES
-- ============================================================
CREATE TABLE content_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('webinar', 'live', 'class', 'pitch')),
  source_file TEXT NOT NULL,
  total_duration_minutes INTEGER,
  segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  hooks_extracted JSONB,
  objections_addressed JSONB,
  objections_missing JSONB,
  creative_suggestions JSONB,
  analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_analyses_cohort ON content_analyses(cohort_id);

-- ============================================================
-- 16. ICP_PROFILES
-- ============================================================
CREATE TABLE icp_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL CHECK (source IN ('manual', 'auto_from_buyers')),
  buyer_cohort_ids UUID[],
  accuracy_feedback JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_icp_profiles_product ON icp_profiles(product_id);

-- ============================================================
-- 17. ALERTS
-- ============================================================
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('icp_quality_drop', 'objection_spike', 'ad_quality_drop', 'profile_deviation', 'suggestion')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  data JSONB,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_cohort ON alerts(cohort_id);
CREATE INDEX idx_alerts_type ON alerts(alert_type);

-- ============================================================
-- 18. MESSAGE_DISPATCHES
-- ============================================================
CREATE TABLE message_dispatches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'sms')),
  segment_filter JSONB NOT NULL,
  template TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'partial_failure')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX idx_dispatches_cohort ON message_dispatches(cohort_id);

-- ============================================================
-- 19. MESSAGE_DISPATCH_ITEMS
-- ============================================================
CREATE TABLE message_dispatch_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dispatch_id UUID NOT NULL REFERENCES message_dispatches(id) ON DELETE CASCADE,
  respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  channel_address TEXT NOT NULL,
  personalized_body TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),
  external_id TEXT,
  sent_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX idx_dispatch_items_dispatch ON message_dispatch_items(dispatch_id);
CREATE INDEX idx_dispatch_items_respondent ON message_dispatch_items(respondent_id);

-- ============================================================
-- 20. CHAT_SESSIONS
-- ============================================================
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  cohort_id UUID REFERENCES cohorts(id) ON DELETE SET NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_sessions_org ON chat_sessions(org_id);
CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id);

-- ============================================================
-- 21. CHAT_MESSAGES
-- ============================================================
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sources_used JSONB,
  tokens_used INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE respondents ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE respondent_answers_closed ENABLE ROW LEVEL SECURITY;
ALTER TABLE respondent_answers_open ENABLE ROW LEVEL SECURITY;
ALTER TABLE respondent_utm_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE icp_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_dispatch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES — Organization-level isolation
-- ============================================================

-- Users can see their own org
CREATE POLICY "users_own_org" ON organizations
  FOR ALL USING (id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Users can see users in their org
CREATE POLICY "users_same_org" ON users
  FOR ALL USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Products: org-scoped
CREATE POLICY "products_org_scope" ON products
  FOR ALL USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Cohorts: via product → org
CREATE POLICY "cohorts_org_scope" ON cohorts
  FOR ALL USING (product_id IN (
    SELECT id FROM products WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Surveys: via cohort → product → org
CREATE POLICY "surveys_org_scope" ON surveys
  FOR ALL USING (cohort_id IN (
    SELECT c.id FROM cohorts c
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Survey columns: via survey
CREATE POLICY "survey_columns_org_scope" ON survey_columns
  FOR ALL USING (survey_id IN (
    SELECT s.id FROM surveys s
    JOIN cohorts c ON s.cohort_id = c.id
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Respondents: via cohort → product → org
CREATE POLICY "respondents_org_scope" ON respondents
  FOR ALL USING (cohort_id IN (
    SELECT c.id FROM cohorts c
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Identity aliases: via respondent
CREATE POLICY "aliases_org_scope" ON identity_aliases
  FOR ALL USING (respondent_id IN (
    SELECT r.id FROM respondents r
    JOIN cohorts c ON r.cohort_id = c.id
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Answers closed: via respondent
CREATE POLICY "answers_closed_org_scope" ON respondent_answers_closed
  FOR ALL USING (respondent_id IN (
    SELECT r.id FROM respondents r
    JOIN cohorts c ON r.cohort_id = c.id
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Answers open: via respondent
CREATE POLICY "answers_open_org_scope" ON respondent_answers_open
  FOR ALL USING (respondent_id IN (
    SELECT r.id FROM respondents r
    JOIN cohorts c ON r.cohort_id = c.id
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- UTM sources: via respondent
CREATE POLICY "utm_org_scope" ON respondent_utm_sources
  FOR ALL USING (respondent_id IN (
    SELECT r.id FROM respondents r
    JOIN cohorts c ON r.cohort_id = c.id
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Interactions: via cohort
CREATE POLICY "interactions_org_scope" ON interactions
  FOR ALL USING (cohort_id IN (
    SELECT c.id FROM cohorts c
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Ad metrics: via cohort
CREATE POLICY "ad_metrics_org_scope" ON ad_metrics
  FOR ALL USING (cohort_id IN (
    SELECT c.id FROM cohorts c
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Ad creatives: via cohort
CREATE POLICY "ad_creatives_org_scope" ON ad_creatives
  FOR ALL USING (cohort_id IN (
    SELECT c.id FROM cohorts c
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Content analyses: via cohort
CREATE POLICY "content_analyses_org_scope" ON content_analyses
  FOR ALL USING (cohort_id IN (
    SELECT c.id FROM cohorts c
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- ICP profiles: via product
CREATE POLICY "icp_profiles_org_scope" ON icp_profiles
  FOR ALL USING (product_id IN (
    SELECT id FROM products WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Alerts: via cohort
CREATE POLICY "alerts_org_scope" ON alerts
  FOR ALL USING (cohort_id IN (
    SELECT c.id FROM cohorts c
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Message dispatches: via cohort
CREATE POLICY "dispatches_org_scope" ON message_dispatches
  FOR ALL USING (cohort_id IN (
    SELECT c.id FROM cohorts c
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Dispatch items: via dispatch
CREATE POLICY "dispatch_items_org_scope" ON message_dispatch_items
  FOR ALL USING (dispatch_id IN (
    SELECT md.id FROM message_dispatches md
    JOIN cohorts c ON md.cohort_id = c.id
    JOIN products p ON c.product_id = p.id
    WHERE p.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- Chat sessions: org-scoped
CREATE POLICY "chat_sessions_org_scope" ON chat_sessions
  FOR ALL USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Chat messages: via session
CREATE POLICY "chat_messages_org_scope" ON chat_messages
  FOR ALL USING (session_id IN (
    SELECT id FROM chat_sessions WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  ));

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER icp_profiles_updated_at
  BEFORE UPDATE ON icp_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Slugify function
CREATE OR REPLACE FUNCTION slugify(text TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN lower(
    regexp_replace(
      regexp_replace(
        translate(text, 'àáâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiioooooouuuucn'),
        '[^a-zA-Z0-9\s-]', '', 'g'
      ),
      '[\s]+', '-', 'g'
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

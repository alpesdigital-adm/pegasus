// Pegasus Database Types
// Auto-generated from PRD schema — update as migrations evolve

export type PlanType = 'starter' | 'pro' | 'scale'
export type UserRole = 'owner' | 'admin' | 'traffic_manager' | 'viewer'
export type CohortType = 'launch' | 'evergreen' | 'live_event'
export type CohortStatus = 'planning' | 'capturing' | 'live' | 'selling' | 'closed'
export type SurveyType = 'captacao' | 'pre_venda' | 'engajamento' | 'pos_venda' | 'feedback' | 'onboarding'
export type SurveyStatus = 'uploaded' | 'classifying' | 'classified' | 'processing' | 'done' | 'error'
export type SourcePlatform = 'typeform' | 'google_forms' | 'other'
export type Temperature = 'cold' | 'warm' | 'hot'

export type ColumnType =
  | 'identifier_email'
  | 'identifier_name'
  | 'identifier_phone'
  | 'identifier_doc'
  | 'identifier_social'
  | 'utm'
  | 'metadata_timestamp'
  | 'metadata_system'
  | 'noise'
  | 'closed_multiple_choice'
  | 'closed_scale'
  | 'closed_range'
  | 'closed_binary'
  | 'closed_checkbox_group'
  | 'semi_closed'
  | 'open'

export type SemanticCategory =
  | 'qualification'
  | 'professional_profile'
  | 'revenue_current'
  | 'revenue_desired'
  | 'pain_challenge'
  | 'desire_goal'
  | 'purchase_intent'
  | 'purchase_decision'
  | 'purchase_objection'
  | 'experience_time'
  | 'how_discovered'
  | 'feedback'
  | 'hypothetical'
  | 'content_request'
  | 'personal_data'
  | 'investment_willingness'
  | 'engagement_checklist'

export type InteractionSourceType =
  | 'zoom_chat_v1'
  | 'zoom_chat_v2'
  | 'vtt_transcript'
  | 'fathom_transcript'
  | 'whatsapp'
  | 'testimony'

export type SemanticTag =
  | 'pain'
  | 'desire'
  | 'objection'
  | 'decision'
  | 'insight'
  | 'testimony'
  | 'engagement'
  | 'question'
  | 'noise'

export interface Organization {
  id: string
  name: string
  slug: string
  plan: PlanType
  plan_limits: {
    max_products: number
    max_respondents: number
    max_users: number
  }
  stripe_customer_id: string | null
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  org_id: string
  email: string
  name: string
  role: UserRole
  created_at: string
}

export interface Product {
  id: string
  org_id: string
  name: string
  expert_name: string | null
  slug: string
  description: string | null
  icp_qualifier_field: string | null
  staff_names: string[] | null
  created_at: string
}

export interface Cohort {
  id: string
  product_id: string
  name: string
  slug: string
  type: CohortType | null
  start_date: string | null
  end_date: string | null
  status: CohortStatus
  created_at: string
}

export interface Survey {
  id: string
  cohort_id: string
  name: string
  original_filename: string
  survey_type: SurveyType
  source_platform: SourcePlatform | null
  total_rows: number | null
  processed_rows: number | null
  status: SurveyStatus
  error_message: string | null
  classification_result: Record<string, unknown> | null
  storage_path: string
  created_at: string
  processed_at: string | null
}

export interface Respondent {
  id: string
  cohort_id: string
  email: string
  name: string | null
  phone: string | null
  document_id: string | null
  social_handle: string | null
  city: string | null
  state: string | null
  country: string | null
  is_buyer: boolean
  buyer_product: string | null
  buyer_date: string | null
  icp_score: number | null
  icp_score_details: Record<string, unknown> | null
  temperature: Temperature | null
  stage: string | null
  surveys_responded: number | null
  interactions_count: number | null
  first_seen_at: string
  last_seen_at: string
  created_at: string
}

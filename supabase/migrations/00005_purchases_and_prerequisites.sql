-- ============================================================
-- 1. PURCHASES — granular transaction records
-- ============================================================
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  respondent_id UUID NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  amount_paid NUMERIC,
  payment_method TEXT,
  installments INTEGER,
  purchased_at TIMESTAMPTZ,
  source_survey_id UUID REFERENCES surveys(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchases_respondent ON purchases(respondent_id);
CREATE INDEX idx_purchases_cohort ON purchases(cohort_id);
CREATE INDEX idx_purchases_product_name ON purchases(product_name);

-- RLS
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchases_org_access" ON purchases
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

-- ============================================================
-- 2. PRODUCT PREREQUISITES — which products are required before
-- ============================================================
CREATE TABLE product_prerequisites (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  prerequisite_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, prerequisite_product_id),
  CHECK (product_id != prerequisite_product_id)
);

-- RLS
ALTER TABLE product_prerequisites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_prerequisites_org_access" ON product_prerequisites
  FOR ALL TO authenticated
  USING (
    product_id IN (
      SELECT id FROM products WHERE org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    product_id IN (
      SELECT id FROM products WHERE org_id = get_user_org_id()
    )
  );

-- ============================================================
-- 3. NEW COLUMN TYPES for sales data
-- ============================================================
-- Add sales-specific column types to the CHECK constraint on survey_columns
ALTER TABLE survey_columns DROP CONSTRAINT IF EXISTS survey_columns_column_type_check;
ALTER TABLE survey_columns ADD CONSTRAINT survey_columns_column_type_check
  CHECK (column_type IN (
    'identifier_email', 'identifier_name', 'identifier_phone', 'identifier_doc', 'identifier_social',
    'utm', 'metadata_timestamp', 'metadata_system', 'noise',
    'closed_multiple_choice', 'closed_scale', 'closed_range', 'closed_binary', 'closed_checkbox_group',
    'semi_closed', 'open',
    'sale_product_name', 'sale_amount', 'sale_payment_method', 'sale_installments', 'sale_date'
  ));

-- Also update classification_overrides to accept new types
ALTER TABLE classification_overrides DROP CONSTRAINT IF EXISTS classification_overrides_column_type_check;
ALTER TABLE classification_overrides ADD CONSTRAINT classification_overrides_column_type_check
  CHECK (column_type IN (
    'identifier_email', 'identifier_name', 'identifier_phone', 'identifier_doc', 'identifier_social',
    'utm', 'metadata_timestamp', 'metadata_system', 'noise',
    'closed_multiple_choice', 'closed_scale', 'closed_range', 'closed_binary', 'closed_checkbox_group',
    'semi_closed', 'open',
    'sale_product_name', 'sale_amount', 'sale_payment_method', 'sale_installments', 'sale_date'
  ));

-- ============================================================
-- 4. ADD 'vendas' TO SURVEY TYPE
-- ============================================================
-- survey_type is stored as TEXT, no constraint to update.
-- The application-level enum is what needs updating.

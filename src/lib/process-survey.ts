import { SupabaseClient } from '@supabase/supabase-js'
import type { ColumnClassification } from '@/lib/classify-columns'

interface ProcessOptions {
  supabase: SupabaseClient
  surveyId: string
  cohortId: string
  headers: string[]
  rows: string[][]
  columns: ColumnClassification[]
  surveyType?: string
}

const BATCH_SIZE = 50

/**
 * Process survey data: normalize identifiers, create/update respondents,
 * distribute answers to correct tables.
 *
 * Optimized with batch inserts — groups rows into chunks of BATCH_SIZE
 * to minimize round-trips to the database.
 */
export async function processSurvey(opts: ProcessOptions) {
  const { supabase, surveyId, cohortId, headers, rows, columns, surveyType } = opts
  const isBuyerSurvey = surveyType === 'pos_venda'
  const isSalesSurvey = surveyType === 'vendas'

  // Find key columns
  const emailCol = columns.find((c) => c.columnType === 'identifier_email')
  if (!emailCol) {
    throw new Error('Coluna de email não encontrada. É necessária para identificar respondentes.')
  }

  const nameCol = columns.find((c) => c.columnType === 'identifier_name')
  const phoneCol = columns.find((c) => c.columnType === 'identifier_phone')
  const docCol = columns.find((c) => c.columnType === 'identifier_doc')
  const socialCol = columns.find((c) => c.columnType === 'identifier_social')

  // UTM columns
  const utmCols = columns.filter((c) => c.columnType === 'utm')

  // Sales columns
  const saleProductCol = columns.find((c) => c.columnType === 'sale_product_name')
  const saleAmountCol = columns.find((c) => c.columnType === 'sale_amount')
  const salePaymentCol = columns.find((c) => c.columnType === 'sale_payment_method')
  const saleInstallmentsCol = columns.find((c) => c.columnType === 'sale_installments')
  const saleDateCol = columns.find((c) => c.columnType === 'sale_date')

  // Answer columns (closed + open)
  const closedTypes = [
    'closed_multiple_choice', 'closed_scale', 'closed_range',
    'closed_binary', 'closed_checkbox_group', 'semi_closed',
  ]
  const closedCols = columns.filter((c) => closedTypes.includes(c.columnType))
  const openCols = columns.filter((c) => c.columnType === 'open')

  // ─── Column deduplication at ingestion level ───
  const { data: existingCohortColumns } = await supabase
    .from('survey_columns')
    .select('id, normalized_header, column_type, semantic_category, surveys!inner(cohort_id)')
    .eq('surveys.cohort_id', cohortId)

  const existingColumns = (existingCohortColumns || []).map((ec) => ({
    id: ec.id as string,
    normalizedHeader: ec.normalized_header as string,
    columnType: ec.column_type as string,
    semanticCategory: ec.semantic_category as string | null,
  }))

  function findExistingColumn(
    normalizedHeader: string,
    columnType: string,
    semanticCategory: string | null
  ): string | null {
    const exactMatch = existingColumns.find(
      (ec) => ec.normalizedHeader === normalizedHeader && ec.columnType === columnType
    )
    if (exactMatch) return exactMatch.id

    if (semanticCategory) {
      const headerWords = new Set(
        normalizedHeader.toLowerCase().split(/[_\s]+/).filter((w) => w.length > 2)
      )
      for (const ec of existingColumns) {
        if (ec.columnType !== columnType) continue
        if (ec.semanticCategory !== semanticCategory) continue
        const existingWords = new Set(
          ec.normalizedHeader.toLowerCase().split(/[_\s]+/).filter((w) => w.length > 2)
        )
        let overlap = 0
        for (const word of headerWords) {
          if (existingWords.has(word)) overlap++
        }
        const smaller = Math.min(headerWords.size, existingWords.size)
        if (smaller > 0 && overlap / smaller >= 0.5) return ec.id
      }
    }
    return null
  }

  // Create survey_columns records, reusing existing column IDs where possible
  const colIdMap = new Map<number, string>()
  const newColumnsToInsert: {
    survey_id: string
    column_index: number
    original_header: string
    normalized_header: string
    column_type: string
    semantic_category: string | null
    checkbox_group_name: string | null
    detected_options: string | null
    include_in_analysis: boolean
    user_override: boolean
  }[] = []

  const relevantColumns = columns.filter(
    (c) => c.columnType !== 'noise' && c.columnType !== 'metadata_system'
  )

  for (const c of relevantColumns) {
    const normalizedHeader = c.normalizedHeader || headers[c.index]
    const existingId = findExistingColumn(normalizedHeader, c.columnType, c.semanticCategory || null)

    if (existingId) {
      colIdMap.set(c.index, existingId)
    } else {
      newColumnsToInsert.push({
        survey_id: surveyId,
        column_index: c.index,
        original_header: headers[c.index],
        normalized_header: normalizedHeader,
        column_type: c.columnType,
        semantic_category: c.semanticCategory || null,
        checkbox_group_name: c.checkboxGroupName || null,
        detected_options: closedTypes.includes(c.columnType)
          ? JSON.stringify(getUniqueValues(rows, c.index))
          : null,
        include_in_analysis: true,
        user_override: false,
      })
    }
  }

  if (newColumnsToInsert.length > 0) {
    const { data: insertedColumns, error: colError } = await supabase
      .from('survey_columns')
      .insert(newColumnsToInsert)
      .select()

    if (colError) throw new Error(`Erro ao salvar colunas: ${colError.message}`)

    insertedColumns?.forEach((col) => {
      colIdMap.set(col.column_index, col.id)
    })
  }

  // ─── Process rows in batches ───
  let processedCount = 0

  for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
    const batch = rows.slice(batchStart, batchStart + BATCH_SIZE)

    // Step 1: Prepare and upsert all respondents in this batch at once
    const respondentRows: {
      rowIndex: number
      email: string
      data: Record<string, unknown>
    }[] = []

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i]
      const rawEmail = (row[emailCol.index] || '').trim()
      if (!rawEmail || !rawEmail.includes('@')) continue

      const email = normalizeEmail(rawEmail)
      const name = nameCol ? (row[nameCol.index] || '').trim() : null
      const phone = phoneCol ? normalizePhone(row[phoneCol.index] || '') : null
      const doc = docCol ? (row[docCol.index] || '').trim() : null
      const social = socialCol ? (row[socialCol.index] || '').trim() : null

      const respondentData: Record<string, unknown> = {
        cohort_id: cohortId,
        email,
        name: name || undefined,
        phone: phone || undefined,
        document_id: doc || undefined,
        social_handle: social || undefined,
        last_seen_at: new Date().toISOString(),
      }

      if (isBuyerSurvey || isSalesSurvey) {
        respondentData.is_buyer = true
      }

      respondentRows.push({ rowIndex: i, email, data: respondentData })
    }

    if (respondentRows.length === 0) {
      processedCount += batch.length
      continue
    }

    // Batch upsert respondents
    const { data: upsertedRespondents, error: batchRespError } = await supabase
      .from('respondents')
      .upsert(
        respondentRows.map((r) => r.data),
        { onConflict: 'cohort_id,email', ignoreDuplicates: false }
      )
      .select('id, email')

    if (batchRespError || !upsertedRespondents) {
      console.error('Batch respondent upsert error:', batchRespError)
      processedCount += batch.length
      continue
    }

    // Build email → respondent_id map
    const emailToId = new Map<string, string>()
    for (const r of upsertedRespondents) {
      emailToId.set(r.email, r.id)
    }

    // Step 2: Collect all answers, UTMs, purchases for this batch
    const allClosedAnswers: Record<string, unknown>[] = []
    const allOpenAnswers: Record<string, unknown>[] = []
    const allUtmRecords: Record<string, unknown>[] = []
    const allPurchases: Record<string, unknown>[] = []

    for (const rr of respondentRows) {
      const row = batch[rr.rowIndex]
      const respondentId = emailToId.get(rr.email)
      if (!respondentId) continue

      // Closed answers
      for (const c of closedCols) {
        const val = (row[c.index] || '').trim()
        if (!val) continue
        const colId = colIdMap.get(c.index)
        if (!colId) continue

        if (c.columnType === 'closed_checkbox_group') {
          allClosedAnswers.push({
            respondent_id: respondentId,
            survey_id: surveyId,
            column_id: colId,
            value: val,
            checkbox_group_values: [val],
          })
        } else {
          const numericInfo = extractNumeric(val)
          allClosedAnswers.push({
            respondent_id: respondentId,
            survey_id: surveyId,
            column_id: colId,
            value: val,
            numeric_value: numericInfo.value,
            numeric_range_min: numericInfo.min,
            numeric_range_max: numericInfo.max,
          })
        }
      }

      // Open answers
      for (const c of openCols) {
        const val = (row[c.index] || '').trim()
        if (!val || val.length <= 1) continue
        const colId = colIdMap.get(c.index)
        if (!colId) continue

        allOpenAnswers.push({
          respondent_id: respondentId,
          survey_id: surveyId,
          column_id: colId,
          value: val,
          semantic_category: c.semanticCategory || null,
          embedding_input: `${c.normalizedHeader || headers[c.index]}: ${val}`,
        })
      }

      // UTM sources
      if (utmCols.length > 0) {
        const utmData: Record<string, string | null> = {}
        utmCols.forEach((c) => {
          const val = (row[c.index] || '').trim()
          const cleanVal = val === 'xxxxx' || val === '' ? null : val
          const header = (c.normalizedHeader || headers[c.index]).toLowerCase()

          if (header.includes('source')) utmData.utm_source = cleanVal
          else if (header.includes('medium')) utmData.utm_medium = cleanVal
          else if (header.includes('campaign')) utmData.utm_campaign = cleanVal
          else if (header.includes('term')) utmData.utm_term = cleanVal
          else if (header.includes('content')) utmData.utm_content = cleanVal
          else if (header.includes('utm_id') || header.includes('id')) utmData.utm_id = cleanVal
        })

        const hasAnyUtm = Object.values(utmData).some((v) => v !== null)
        if (hasAnyUtm) {
          allUtmRecords.push({
            respondent_id: respondentId,
            survey_id: surveyId,
            ...utmData,
          })
        }
      }

      // Purchases (sales data)
      if (isSalesSurvey) {
        const productName = saleProductCol ? (row[saleProductCol.index] || '').trim() : null
        const amountRaw = saleAmountCol ? (row[saleAmountCol.index] || '').trim() : null
        const paymentMethod = salePaymentCol ? (row[salePaymentCol.index] || '').trim() : null
        const installmentsRaw = saleInstallmentsCol ? (row[saleInstallmentsCol.index] || '').trim() : null
        const dateRaw = saleDateCol ? (row[saleDateCol.index] || '').trim() : null

        if (productName) {
          const amountParsed = amountRaw ? parseNumber(amountRaw) : null
          const installmentsParsed = installmentsRaw ? parseInt(installmentsRaw.replace(/\D/g, ''), 10) || null : null
          const purchasedAt = dateRaw ? parseDate(dateRaw) : null

          allPurchases.push({
            respondent_id: respondentId,
            cohort_id: cohortId,
            product_name: productName,
            amount_paid: amountParsed,
            payment_method: paymentMethod || null,
            installments: installmentsParsed,
            purchased_at: purchasedAt,
            source_survey_id: surveyId,
          })
        }
      }
    }

    // Step 3: Batch insert all collected data in parallel
    const insertPromises: PromiseLike<unknown>[] = []

    if (allClosedAnswers.length > 0) {
      insertPromises.push(
        supabase.from('respondent_answers_closed').insert(allClosedAnswers)
      )
    }
    if (allOpenAnswers.length > 0) {
      insertPromises.push(
        supabase.from('respondent_answers_open').insert(allOpenAnswers)
      )
    }
    if (allUtmRecords.length > 0) {
      insertPromises.push(
        supabase.from('respondent_utm_sources').insert(allUtmRecords)
      )
    }
    if (allPurchases.length > 0) {
      insertPromises.push(
        supabase.from('purchases').insert(allPurchases)
      )
    }

    // Run all inserts in parallel
    await Promise.all(insertPromises)

    processedCount += batch.length

    // Update progress once per batch
    await supabase
      .from('surveys')
      .update({ processed_rows: processedCount })
      .eq('id', surveyId)
  }

  // Final update
  await supabase
    .from('surveys')
    .update({
      processed_rows: processedCount,
      status: 'done',
      processed_at: new Date().toISOString(),
    })
    .eq('id', surveyId)

  return { processedCount }
}

// ============================================================
// Normalization helpers
// ============================================================

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

function normalizePhone(phone: string): string | null {
  if (!phone) return null
  let digits = phone.replace(/\D/g, '')
  if (!digits) return null

  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2)
  }
  if (digits.startsWith('0') && digits.length > 11) {
    digits = digits.slice(1)
  }
  if (digits.length === 10 && parseInt(digits[2]) >= 6) {
    digits = digits.slice(0, 2) + '9' + digits.slice(2)
  }

  return digits
}

function extractNumeric(value: string): {
  value: number | null
  min: number | null
  max: number | null
} {
  const rangeMatch = value.match(
    /(?:de|entre)?\s*([\d.,]+)\s*(?:a|e|até|-)\s*([\d.,]+)/i
  )
  if (rangeMatch) {
    const min = parseNumber(rangeMatch[1])
    const max = parseNumber(rangeMatch[2])
    return { value: null, min, max }
  }

  const upToMatch = value.match(/(?:até|menos de|menor (?:que|de))\s*([\d.,]+)/i)
  if (upToMatch) {
    return { value: null, min: 0, max: parseNumber(upToMatch[1]) }
  }

  const aboveMatch = value.match(/(?:acima de|mais de|maior (?:que|de))\s*([\d.,]+)/i)
  if (aboveMatch) {
    return { value: null, min: parseNumber(aboveMatch[1]), max: null }
  }

  const numMatch = value.match(/([\d.,]+)/)
  if (numMatch) {
    return { value: parseNumber(numMatch[1]), min: null, max: null }
  }

  return { value: null, min: null, max: null }
}

function parseNumber(str: string): number | null {
  let clean = str.replace(/\s/g, '')
  if (clean.includes(',') && clean.includes('.')) {
    clean = clean.replace(/\./g, '').replace(',', '.')
  } else if (clean.includes(',')) {
    clean = clean.replace(',', '.')
  }
  const num = parseFloat(clean)
  return isNaN(num) ? null : num
}

function parseDate(raw: string): string | null {
  if (!raw) return null
  const iso = new Date(raw)
  if (!isNaN(iso.getTime())) return iso.toISOString()

  const brMatch = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/)
  if (brMatch) {
    const day = parseInt(brMatch[1], 10)
    const month = parseInt(brMatch[2], 10) - 1
    let year = parseInt(brMatch[3], 10)
    if (year < 100) year += 2000
    const d = new Date(year, month, day)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  return null
}

function getUniqueValues(rows: string[][], colIndex: number): string[] {
  const unique = new Set<string>()
  rows.forEach((row) => {
    const val = (row[colIndex] || '').trim()
    if (val) unique.add(val)
  })
  return Array.from(unique).slice(0, 50)
}

import { SupabaseClient } from '@supabase/supabase-js'
import type { ColumnClassification } from '@/lib/classify-columns'

interface ProcessOptions {
  supabase: SupabaseClient
  surveyId: string
  cohortId: string
  headers: string[]
  rows: string[][]
  columns: ColumnClassification[]
}

/**
 * Process survey data: normalize identifiers, create/update respondents,
 * distribute answers to correct tables
 */
export async function processSurvey(opts: ProcessOptions) {
  const { supabase, surveyId, cohortId, headers, rows, columns } = opts

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

  // Answer columns (closed + open)
  const closedTypes = [
    'closed_multiple_choice', 'closed_scale', 'closed_range',
    'closed_binary', 'closed_checkbox_group', 'semi_closed',
  ]
  const closedCols = columns.filter((c) => closedTypes.includes(c.columnType))
  const openCols = columns.filter((c) => c.columnType === 'open')

  // Create survey_columns records
  const surveyColumnsToInsert = columns
    .filter((c) => c.columnType !== 'noise' && c.columnType !== 'metadata_system')
    .map((c) => ({
      survey_id: surveyId,
      column_index: c.index,
      original_header: headers[c.index],
      normalized_header: c.normalizedHeader || headers[c.index],
      column_type: c.columnType,
      semantic_category: c.semanticCategory || null,
      checkbox_group_name: c.checkboxGroupName || null,
      detected_options: closedTypes.includes(c.columnType)
        ? JSON.stringify(getUniqueValues(rows, c.index))
        : null,
      include_in_analysis: true,
      user_override: false,
    }))

  const { data: insertedColumns, error: colError } = await supabase
    .from('survey_columns')
    .insert(surveyColumnsToInsert)
    .select()

  if (colError) throw new Error(`Erro ao salvar colunas: ${colError.message}`)

  // Build column ID map
  const colIdMap = new Map<number, string>()
  insertedColumns?.forEach((col) => {
    colIdMap.set(col.column_index, col.id)
  })

  let processedCount = 0

  for (const row of rows) {
    const rawEmail = (row[emailCol.index] || '').trim()
    if (!rawEmail || !rawEmail.includes('@')) {
      processedCount++
      continue
    }

    const email = normalizeEmail(rawEmail)
    const name = nameCol ? (row[nameCol.index] || '').trim() : null
    const phone = phoneCol ? normalizePhone(row[phoneCol.index] || '') : null
    const doc = docCol ? (row[docCol.index] || '').trim() : null
    const social = socialCol ? (row[socialCol.index] || '').trim() : null

    // Upsert respondent
    const { data: respondent, error: respError } = await supabase
      .from('respondents')
      .upsert(
        {
          cohort_id: cohortId,
          email,
          name: name || undefined,
          phone: phone || undefined,
          document_id: doc || undefined,
          social_handle: social || undefined,
          last_seen_at: new Date().toISOString(),
        },
        {
          onConflict: 'cohort_id,email',
          ignoreDuplicates: false,
        }
      )
      .select('id, surveys_responded')
      .single()

    if (respError || !respondent) {
      console.error(`Error upserting respondent ${email}:`, respError)
      processedCount++
      continue
    }

    // Update surveys_responded count
    await supabase
      .from('respondents')
      .update({ surveys_responded: (respondent.surveys_responded || 0) + 1 })
      .eq('id', respondent.id)

    // Save closed answers
    const closedAnswers = closedCols
      .filter((c) => {
        const val = (row[c.index] || '').trim()
        return val !== ''
      })
      .map((c) => {
        const val = (row[c.index] || '').trim()
        const colId = colIdMap.get(c.index)
        if (!colId) return null

        // Handle checkbox groups
        if (c.columnType === 'closed_checkbox_group') {
          return {
            respondent_id: respondent.id,
            survey_id: surveyId,
            column_id: colId,
            value: val,
            checkbox_group_values: [val],
          }
        }

        // Extract numeric values for ranges
        const numericInfo = extractNumeric(val)

        return {
          respondent_id: respondent.id,
          survey_id: surveyId,
          column_id: colId,
          value: val,
          numeric_value: numericInfo.value,
          numeric_range_min: numericInfo.min,
          numeric_range_max: numericInfo.max,
        }
      })
      .filter(Boolean)

    if (closedAnswers.length > 0) {
      await supabase.from('respondent_answers_closed').insert(closedAnswers)
    }

    // Save open answers
    const openAnswers = openCols
      .filter((c) => {
        const val = (row[c.index] || '').trim()
        return val !== '' && val.length > 1
      })
      .map((c) => {
        const val = (row[c.index] || '').trim()
        const colId = colIdMap.get(c.index)
        if (!colId) return null

        return {
          respondent_id: respondent.id,
          survey_id: surveyId,
          column_id: colId,
          value: val,
          semantic_category: c.semanticCategory || null,
          embedding_input: `${c.normalizedHeader || headers[c.index]}: ${val}`,
        }
      })
      .filter(Boolean)

    if (openAnswers.length > 0) {
      await supabase.from('respondent_answers_open').insert(openAnswers)
    }

    // Save UTM sources
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
        await supabase.from('respondent_utm_sources').insert({
          respondent_id: respondent.id,
          survey_id: surveyId,
          ...utmData,
        })
      }
    }

    processedCount++

    // Update progress every 50 rows
    if (processedCount % 50 === 0) {
      await supabase
        .from('surveys')
        .update({ processed_rows: processedCount })
        .eq('id', surveyId)
    }
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
  // Remove everything that's not a digit
  let digits = phone.replace(/\D/g, '')
  if (!digits) return null

  // Remove country code +55 or 55
  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2)
  }
  // Remove leading 0
  if (digits.startsWith('0') && digits.length > 11) {
    digits = digits.slice(1)
  }
  // Add 9th digit for cellphones without it (10 digits, 3rd digit is 6-9)
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
  // Range patterns: "de X a Y", "entre X e Y", "X a Y"
  const rangeMatch = value.match(
    /(?:de|entre)?\s*([\d.,]+)\s*(?:a|e|até|-)\s*([\d.,]+)/i
  )
  if (rangeMatch) {
    const min = parseNumber(rangeMatch[1])
    const max = parseNumber(rangeMatch[2])
    return { value: null, min, max }
  }

  // "Até X", "Menos de X", "Menor que X"
  const upToMatch = value.match(/(?:até|menos de|menor (?:que|de))\s*([\d.,]+)/i)
  if (upToMatch) {
    return { value: null, min: 0, max: parseNumber(upToMatch[1]) }
  }

  // "Acima de X", "Mais de X", "Maior que X"
  const aboveMatch = value.match(/(?:acima de|mais de|maior (?:que|de))\s*([\d.,]+)/i)
  if (aboveMatch) {
    return { value: null, min: parseNumber(aboveMatch[1]), max: null }
  }

  // Simple number
  const numMatch = value.match(/([\d.,]+)/)
  if (numMatch) {
    return { value: parseNumber(numMatch[1]), min: null, max: null }
  }

  return { value: null, min: null, max: null }
}

function parseNumber(str: string): number | null {
  // Handle BR format: 1.234,56 → 1234.56
  let clean = str.replace(/\s/g, '')
  if (clean.includes(',') && clean.includes('.')) {
    clean = clean.replace(/\./g, '').replace(',', '.')
  } else if (clean.includes(',')) {
    clean = clean.replace(',', '.')
  }
  const num = parseFloat(clean)
  return isNaN(num) ? null : num
}

function getUniqueValues(rows: string[][], colIndex: number): string[] {
  const unique = new Set<string>()
  rows.forEach((row) => {
    const val = (row[colIndex] || '').trim()
    if (val) unique.add(val)
  })
  return Array.from(unique).slice(0, 50)
}

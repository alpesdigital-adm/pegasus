import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateICPProfiles } from '@/lib/icp'
import type { RespondentRow, ColumnMeta } from '@/lib/icp'

export const maxDuration = 60

/**
 * POST /api/icp/generate
 *
 * Generates ICP avatar profiles for a product.
 * Body: { productId: string, cohortIds?: string[] }
 *
 * If cohortIds is omitted, uses ALL cohorts for the product.
 * Requires at least 10 buyers to generate profiles.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const { productId, cohortIds } = body as {
      productId: string
      cohortIds?: string[]
    }

    if (!productId) {
      return NextResponse.json({ error: 'productId é obrigatório' }, { status: 400 })
    }

    // Resolve cohorts for this product
    let resolvedCohortIds: string[]

    if (cohortIds && cohortIds.length > 0) {
      resolvedCohortIds = cohortIds
    } else {
      const { data: cohorts } = await supabase
        .from('cohorts')
        .select('id')
        .eq('product_id', productId)

      if (!cohorts || cohorts.length === 0) {
        return NextResponse.json({ error: 'Nenhuma turma encontrada' }, { status: 404 })
      }
      resolvedCohortIds = cohorts.map((c) => c.id)
    }

    // Fetch all survey columns that are closed/semi-closed and have semantic categories
    const { data: surveyColumns } = await supabase
      .from('survey_columns')
      .select(`
        id,
        survey_id,
        original_header,
        normalized_header,
        column_type,
        semantic_category,
        surveys!inner (cohort_id, status)
      `)
      .in('surveys.cohort_id', resolvedCohortIds)
      .eq('surveys.status', 'done')
      .in('column_type', [
        'closed_multiple_choice',
        'closed_scale',
        'closed_range',
        'closed_binary',
        'closed_checkbox_group',
        'semi_closed',
      ])

    if (!surveyColumns || surveyColumns.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma coluna de pesquisa encontrada. Importe pesquisas antes de gerar o ICP.' },
        { status: 400 }
      )
    }

    // Build column metadata (deduplicate by normalized_header)
    const columnMap = new Map<string, ColumnMeta>()
    for (const sc of surveyColumns) {
      if (!columnMap.has(sc.id)) {
        columnMap.set(sc.id, {
          columnId: sc.id,
          header: sc.original_header,
          normalizedHeader: sc.normalized_header,
          columnType: sc.column_type,
          semanticCategory: sc.semantic_category,
          distinctValues: [],
        })
      }
    }

    // Fetch all respondents across these cohorts
    const { data: respondents } = await supabase
      .from('respondents')
      .select('id, is_buyer, email')
      .in('cohort_id', resolvedCohortIds)

    if (!respondents || respondents.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum respondente encontrado' },
        { status: 400 }
      )
    }

    const buyerCount = respondents.filter((r) => r.is_buyer).length
    if (buyerCount < 10) {
      return NextResponse.json(
        {
          error: `Mínimo de 10 compradores necessário para gerar ICP. Atualmente: ${buyerCount}.`,
          buyerCount,
        },
        { status: 400 }
      )
    }

    // Fetch all closed answers for these respondents
    const respondentIds = respondents.map((r) => r.id)
    const columnIds = Array.from(columnMap.keys())

    // Fetch in batches if needed (Supabase has a limit)
    const allAnswers: { respondent_id: string; column_id: string; value: string }[] = []
    const BATCH_SIZE = 500

    for (let i = 0; i < respondentIds.length; i += BATCH_SIZE) {
      const batch = respondentIds.slice(i, i + BATCH_SIZE)
      const { data: answers } = await supabase
        .from('respondent_answers_closed')
        .select('respondent_id, column_id, value')
        .in('respondent_id', batch)
        .in('column_id', columnIds)

      if (answers) allAnswers.push(...answers)
    }

    // Build RespondentRow array
    const respondentMap = new Map(respondents.map((r) => [r.id, r]))
    const rowsMap = new Map<string, RespondentRow>()

    for (const r of respondents) {
      rowsMap.set(r.id, {
        respondentId: r.id,
        isBuyer: r.is_buyer,
        answers: {},
      })
    }

    for (const a of allAnswers) {
      const row = rowsMap.get(a.respondent_id)
      if (row) {
        row.answers[a.column_id] = a.value
      }
    }

    // Populate distinct values in column metadata
    for (const a of allAnswers) {
      const col = columnMap.get(a.column_id)
      if (col && !col.distinctValues.includes(a.value)) {
        col.distinctValues.push(a.value)
      }
    }

    const rows = Array.from(rowsMap.values())
    const columns = Array.from(columnMap.values())

    // Filter out columns with only 1 distinct value (no information gain)
    const usableColumns = columns.filter((c) => c.distinctValues.length >= 2)

    // Generate ICP profiles
    const result = generateICPProfiles(rows, usableColumns)

    // Save to icp_profiles table
    // Delete existing auto-generated profiles for this product
    await supabase
      .from('icp_profiles')
      .delete()
      .eq('product_id', productId)
      .eq('source', 'auto_from_buyers')

    // Insert new profiles
    for (const avatar of result.avatars) {
      await supabase.from('icp_profiles').insert({
        product_id: productId,
        name: avatar.label,
        description: avatar.description,
        rules: {
          closed_rules: avatar.closedRules,
          tree_conditions: avatar.treeConditions,
          conversion_probability: avatar.conversionProbability,
          buyer_count: avatar.buyerCount,
          total_match_count: avatar.totalMatchCount,
          buyer_coverage: avatar.buyerCoverage,
          avatar_index: avatar.index,
        },
        source: 'auto_from_buyers',
        buyer_cohort_ids: resolvedCohortIds,
      })
    }

    return NextResponse.json({
      result,
      message: `${result.avatars.length} avatar(es) gerado(s) com sucesso.`,
    })
  } catch (err) {
    console.error('ICP generate error:', err)
    return NextResponse.json(
      { error: 'Erro interno ao gerar perfil ICP' },
      { status: 500 }
    )
  }
}

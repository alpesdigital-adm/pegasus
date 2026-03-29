import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateICPProfiles, deduplicateColumns, remapAnswers } from '@/lib/icp'
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

    // Enrich buyer status from purchases table
    // A respondent is a buyer if they have any purchase record in these cohorts
    const respondentIds = respondents.map((r) => r.id)
    const { data: purchases } = await supabase
      .from('purchases')
      .select('respondent_id, product_name, amount_paid')
      .in('respondent_id', respondentIds)

    const purchasesByRespondent = new Map<string, { productNames: Set<string>; totalSpent: number }>()
    if (purchases) {
      for (const p of purchases) {
        if (!purchasesByRespondent.has(p.respondent_id)) {
          purchasesByRespondent.set(p.respondent_id, { productNames: new Set(), totalSpent: 0 })
        }
        const entry = purchasesByRespondent.get(p.respondent_id)!
        entry.productNames.add(p.product_name)
        entry.totalSpent += Number(p.amount_paid) || 0
      }
    }

    // Update buyer flag: use purchases if available, fallback to is_buyer flag
    const hasPurchaseData = purchasesByRespondent.size > 0
    for (const r of respondents) {
      if (hasPurchaseData) {
        r.is_buyer = purchasesByRespondent.has(r.id)
      }
    }

    // Fetch product prerequisites to use as qualification features
    const { data: prerequisites } = await supabase
      .from('product_prerequisites')
      .select('prerequisite_product_id, products!product_prerequisites_prerequisite_product_id_fkey(name)')
      .eq('product_id', productId)

    // Check which respondents have purchased prerequisite products (cross-cohort)
    const hasPrereqs = prerequisites && prerequisites.length > 0
    let prereqSatisfiedSet = new Set<string>()

    if (hasPrereqs) {
      const prereqProductNames = (prerequisites || []).map(
        (p) => ((p as Record<string, unknown>).products as Record<string, string>)?.name
      ).filter(Boolean)

      // Check all purchases across the organization for prerequisite products
      const { data: allOrgPurchases } = await supabase
        .from('purchases')
        .select('respondent_id, product_name, respondents!inner(email)')
        .in('product_name', prereqProductNames)

      if (allOrgPurchases) {
        // Map by email since respondent_id differs across cohorts
        const emailsWithPrereq = new Set(
          allOrgPurchases.map((p) => ((p as Record<string, unknown>).respondents as Record<string, string>)?.email).filter(Boolean)
        )
        const emailToRespondent = new Map(respondents.map((r) => [r.email, r.id]))
        for (const email of emailsWithPrereq) {
          const rid = emailToRespondent.get(email)
          if (rid) prereqSatisfiedSet.add(rid)
        }
      }
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

    // Add purchase-derived synthetic features as virtual columns
    if (hasPurchaseData) {
      // "Has prior purchase" feature — indicates the respondent already opened their wallet
      const virtualColHasPurchase = '__has_prior_purchase'
      columnMap.set(virtualColHasPurchase, {
        columnId: virtualColHasPurchase,
        header: 'Já comprou antes',
        normalizedHeader: 'ja_comprou_antes',
        columnType: 'closed_binary',
        semanticCategory: 'purchase_decision',
        distinctValues: ['Sim', 'Não'],
      })
      for (const [rid, row] of rowsMap) {
        row.answers[virtualColHasPurchase] = purchasesByRespondent.has(rid) ? 'Sim' : 'Não'
      }
    }

    // Prerequisite satisfaction as a feature
    if (hasPrereqs && prereqSatisfiedSet.size > 0) {
      const virtualColPrereq = '__has_prerequisite'
      columnMap.set(virtualColPrereq, {
        columnId: virtualColPrereq,
        header: 'Possui pré-requisito',
        normalizedHeader: 'possui_pre_requisito',
        columnType: 'closed_binary',
        semanticCategory: 'qualification',
        distinctValues: ['Sim', 'Não'],
      })
      for (const [rid, row] of rowsMap) {
        row.answers[virtualColPrereq] = prereqSatisfiedSet.has(rid) ? 'Sim' : 'Não'
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

    // Deduplicate semantically equivalent columns from different surveys
    const dedup = deduplicateColumns(usableColumns, rows)
    const dedupColumns = dedup.groups.map((g) => g.meta)
    const dedupRows = remapAnswers(rows, dedup)

    console.log(
      `ICP column dedup: ${dedup.originalCount} → ${dedup.deduplicatedCount} columns`,
      dedup.groups
        .filter((g) => g.memberIds.length > 1)
        .map((g) => `${g.meta.normalizedHeader}: ${g.memberIds.length} merged`)
    )

    // Generate ICP profiles using deduplicated data
    const result = generateICPProfiles(dedupRows, dedupColumns)

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

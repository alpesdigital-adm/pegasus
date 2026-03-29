import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { scoreBatch } from '@/lib/icp'
import type { AvatarProfile } from '@/lib/icp'

export const maxDuration = 60

/**
 * POST /api/icp/score
 *
 * Score all respondents in a cohort (or set of cohorts) against
 * the product's ICP profiles. Updates respondents.icp_score and
 * respondents.icp_score_details in the database.
 *
 * Body: { productId: string, cohortIds?: string[] }
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

    // Load ICP profiles for this product
    const { data: profiles } = await supabase
      .from('icp_profiles')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: true })

    if (!profiles || profiles.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum perfil ICP encontrado. Gere o perfil antes de scorar.' },
        { status: 400 }
      )
    }

    // Convert DB profiles to AvatarProfile format
    const avatars: AvatarProfile[] = profiles.map((p) => {
      const rules = p.rules as Record<string, unknown>
      return {
        index: (rules.avatar_index as number) || 1,
        label: p.name,
        description: p.description || '',
        closedRules: (rules.closed_rules as AvatarProfile['closedRules']) || [],
        conversionProbability: (rules.conversion_probability as number) || 0,
        buyerCount: (rules.buyer_count as number) || 0,
        totalMatchCount: (rules.total_match_count as number) || 0,
        buyerCoverage: (rules.buyer_coverage as number) || 0,
        treeConditions: (rules.tree_conditions as AvatarProfile['treeConditions']) || [],
      }
    })

    // Resolve cohorts
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

    // Fetch respondents
    const { data: respondents } = await supabase
      .from('respondents')
      .select('id')
      .in('cohort_id', resolvedCohortIds)

    if (!respondents || respondents.length === 0) {
      return NextResponse.json({ error: 'Nenhum respondente encontrado' }, { status: 400 })
    }

    // Collect all column IDs used in the rules
    const allColumnIds = new Set<string>()
    for (const avatar of avatars) {
      for (const rule of avatar.closedRules) {
        allColumnIds.add(rule.columnId)
      }
    }
    const columnIds = Array.from(allColumnIds)

    if (columnIds.length === 0) {
      return NextResponse.json(
        { error: 'Perfis ICP não possuem regras. Regenere o perfil.' },
        { status: 400 }
      )
    }

    // Fetch answers in batches
    const respondentIds = respondents.map((r) => r.id)
    const answersMap = new Map<string, Record<string, string>>()
    const BATCH_SIZE = 500

    for (let i = 0; i < respondentIds.length; i += BATCH_SIZE) {
      const batch = respondentIds.slice(i, i + BATCH_SIZE)
      const { data: answers } = await supabase
        .from('respondent_answers_closed')
        .select('respondent_id, column_id, value')
        .in('respondent_id', batch)
        .in('column_id', columnIds)

      if (answers) {
        for (const a of answers) {
          if (!answersMap.has(a.respondent_id)) {
            answersMap.set(a.respondent_id, {})
          }
          answersMap.get(a.respondent_id)![a.column_id] = a.value
        }
      }
    }

    // Build input for scorer
    const scoringInput = respondentIds.map((id) => ({
      respondentId: id,
      answers: answersMap.get(id) || {},
    }))

    // Run scoring
    const { results, stats } = scoreBatch(scoringInput, avatars)

    // Update respondents in batches
    const UPDATE_BATCH = 100
    let updatedCount = 0

    for (let i = 0; i < results.length; i += UPDATE_BATCH) {
      const batch = results.slice(i, i + UPDATE_BATCH)
      const updates = batch.map((r) =>
        supabase
          .from('respondents')
          .update({
            icp_score: r.bestScore,
            icp_score_details: {
              best_avatar_index: r.bestAvatarIndex,
              best_avatar_label: r.bestAvatarLabel,
              conversion_probability: r.conversionProbability,
              avatar_scores: r.avatarScores.map((as) => ({
                avatar_index: as.avatarIndex,
                avatar_label: as.avatarLabel,
                score: as.score,
                was_capped: as.wasCapped,
                conversion_probability: as.conversionProbability,
              })),
            },
            temperature: r.bestScore >= 70 ? 'hot' : r.bestScore >= 40 ? 'warm' : 'cold',
          })
          .eq('id', r.respondentId)
      )

      await Promise.all(updates)
      updatedCount += batch.length
    }

    return NextResponse.json({
      scored: updatedCount,
      stats,
      avatars: avatars.map((a) => ({
        index: a.index,
        label: a.label,
        conversionProbability: a.conversionProbability,
      })),
    })
  } catch (err) {
    console.error('ICP score error:', err)
    return NextResponse.json(
      { error: 'Erro interno ao calcular scores' },
      { status: 500 }
    )
  }
}

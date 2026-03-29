import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/icp/profiles?productId=xxx
 *
 * List ICP profiles (avatars) for a product.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const productId = request.nextUrl.searchParams.get('productId')
    if (!productId) {
      return NextResponse.json({ error: 'productId é obrigatório' }, { status: 400 })
    }

    const { data: profiles, error } = await supabase
      .from('icp_profiles')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Enrich with avatar display format
    const avatars = (profiles || []).map((p) => {
      const rules = p.rules as Record<string, unknown>
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        source: p.source,
        avatarIndex: (rules.avatar_index as number) || 1,
        conversionProbability: (rules.conversion_probability as number) || 0,
        buyerCount: (rules.buyer_count as number) || 0,
        totalMatchCount: (rules.total_match_count as number) || 0,
        buyerCoverage: (rules.buyer_coverage as number) || 0,
        closedRules: (rules.closed_rules as unknown[]) || [],
        treeConditions: (rules.tree_conditions as unknown[]) || [],
        buyerCohortIds: p.buyer_cohort_ids,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      }
    })

    return NextResponse.json({ avatars })
  } catch (err) {
    console.error('ICP profiles error:', err)
    return NextResponse.json(
      { error: 'Erro interno ao listar perfis ICP' },
      { status: 500 }
    )
  }
}

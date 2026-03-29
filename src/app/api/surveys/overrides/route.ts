import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/surveys/overrides?cohortId=xxx
 * Returns all classification overrides for a cohort (keyed by normalized_header).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const cohortId = request.nextUrl.searchParams.get('cohortId')
    if (!cohortId) return NextResponse.json({ error: 'cohortId obrigatório' }, { status: 400 })

    const { data, error } = await supabase
      .from('classification_overrides')
      .select('normalized_header, column_type, semantic_category')
      .eq('cohort_id', cohortId)

    if (error) throw error

    // Return as a map: normalized_header → { columnType, semanticCategory }
    const overrides: Record<string, { columnType: string; semanticCategory: string | null }> = {}
    for (const row of data || []) {
      overrides[row.normalized_header] = {
        columnType: row.column_type,
        semanticCategory: row.semantic_category,
      }
    }

    return NextResponse.json({ overrides })
  } catch (err) {
    console.error('Overrides GET error:', err)
    return NextResponse.json(
      { error: `Erro ao buscar overrides: ${err instanceof Error ? err.message : 'desconhecido'}` },
      { status: 500 }
    )
  }
}

/**
 * POST /api/surveys/overrides
 * Upsert classification overrides for a cohort.
 * Body: { cohortId, overrides: [{ normalizedHeader, columnType, semanticCategory }] }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body = await request.json()
    const { cohortId, overrides } = body as {
      cohortId: string
      overrides: { normalizedHeader: string; columnType: string; semanticCategory: string | null }[]
    }

    if (!cohortId || !overrides || overrides.length === 0) {
      return NextResponse.json({ error: 'cohortId e overrides obrigatórios' }, { status: 400 })
    }

    // Upsert each override
    const rows = overrides.map((o) => ({
      cohort_id: cohortId,
      normalized_header: o.normalizedHeader,
      column_type: o.columnType,
      semantic_category: o.semanticCategory || null,
      updated_at: new Date().toISOString(),
    }))

    const { error } = await supabase
      .from('classification_overrides')
      .upsert(rows, { onConflict: 'cohort_id,normalized_header' })

    if (error) throw error

    return NextResponse.json({ saved: rows.length })
  } catch (err) {
    console.error('Overrides POST error:', err)
    return NextResponse.json(
      { error: `Erro ao salvar overrides: ${err instanceof Error ? err.message : 'desconhecido'}` },
      { status: 500 }
    )
  }
}

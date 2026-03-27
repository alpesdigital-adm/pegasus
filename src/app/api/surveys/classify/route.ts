import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { classifyColumns } from '@/lib/classify-columns'
import type { ColumnStats } from '@/lib/parsers/csv-xlsx'

export const maxDuration = 120

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const {
      surveyId,
      headers,
      stats,
      sampleRows,
      checkboxGroups,
    } = body as {
      surveyId: string
      headers: string[]
      stats: ColumnStats[]
      sampleRows: string[][]
      checkboxGroups: { groupName: string; columnIndices: number[] }[]
    }

    if (!surveyId || !headers || !stats || !sampleRows) {
      return NextResponse.json(
        { error: 'Campos obrigatórios: surveyId, headers, stats, sampleRows' },
        { status: 400 }
      )
    }

    // Update status to classifying
    await supabase
      .from('surveys')
      .update({ status: 'classifying' })
      .eq('id', surveyId)

    // Call LLM classification
    const classification = await classifyColumns(
      headers,
      stats,
      sampleRows,
      checkboxGroups || []
    )

    // Save classification result
    await supabase
      .from('surveys')
      .update({
        status: 'classified',
        classification_result: classification as unknown as Record<string, unknown>,
      })
      .eq('id', surveyId)

    return NextResponse.json({ classification })
  } catch (err) {
    console.error('Classification error:', err)
    return NextResponse.json(
      { error: `Erro na classificação: ${err instanceof Error ? err.message : 'desconhecido'}` },
      { status: 500 }
    )
  }
}

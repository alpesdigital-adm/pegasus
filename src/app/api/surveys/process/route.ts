import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseFile } from '@/lib/parsers/csv-xlsx'
import { processSurvey } from '@/lib/process-survey'
import type { ColumnClassification } from '@/lib/classify-columns'

export const maxDuration = 300

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
    const { surveyId, columns: userColumns } = body as {
      surveyId: string
      columns: ColumnClassification[]
    }

    if (!surveyId || !userColumns) {
      return NextResponse.json(
        { error: 'Campos obrigatórios: surveyId, columns' },
        { status: 400 }
      )
    }

    // Get survey info
    const { data: survey, error: surveyError } = await supabase
      .from('surveys')
      .select('*')
      .eq('id', surveyId)
      .single()

    if (surveyError || !survey) {
      return NextResponse.json(
        { error: 'Pesquisa não encontrada' },
        { status: 404 }
      )
    }

    // Update status
    await supabase
      .from('surveys')
      .update({ status: 'processing', processed_rows: 0 })
      .eq('id', surveyId)

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('uploads')
      .download(survey.storage_path)

    if (downloadError || !fileData) {
      await supabase.from('surveys').update({ status: 'error', error_message: 'Arquivo não encontrado no storage' }).eq('id', surveyId)
      return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 })
    }

    // Parse the file again
    const buffer = Buffer.from(await fileData.arrayBuffer())
    const parsed = parseFile(buffer, survey.original_filename)

    // Process
    try {
      const result = await processSurvey({
        supabase,
        surveyId,
        cohortId: survey.cohort_id,
        headers: parsed.headers,
        rows: parsed.rows,
        columns: userColumns,
        surveyType: survey.survey_type,
      })

      return NextResponse.json({
        success: true,
        processedCount: result.processedCount,
        totalRows: parsed.totalRows,
      })
    } catch (processError) {
      const msg = processError instanceof Error ? processError.message : 'Erro desconhecido'
      await supabase.from('surveys').update({ status: 'error', error_message: msg }).eq('id', surveyId)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  } catch (err) {
    console.error('Process error:', err)
    return NextResponse.json(
      { error: 'Erro interno no processamento' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseFile, detectCheckboxGroups } from '@/lib/parsers/csv-xlsx'
import { createHash } from 'crypto'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const cohortId = formData.get('cohort_id') as string | null
    const surveyName = formData.get('name') as string | null
    const surveyType = formData.get('survey_type') as string | null

    if (!file || !cohortId || !surveyName || !surveyType) {
      return NextResponse.json(
        { error: 'Campos obrigatórios: file, cohort_id, name, survey_type' },
        { status: 400 }
      )
    }

    // Validate file type
    const filename = file.name.toLowerCase()
    if (!filename.endsWith('.csv') && !filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      return NextResponse.json(
        { error: 'Formato não suportado. Use CSV, XLSX ou XLS.' },
        { status: 400 }
      )
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Compute SHA-256 hash for duplicate detection
    const fileHash = createHash('sha256').update(buffer).digest('hex')

    // Check if this exact file was already uploaded to this cohort
    const { data: existingDuplicate } = await supabase
      .from('surveys')
      .select('id, name, original_filename, created_at')
      .eq('cohort_id', cohortId)
      .eq('file_hash', fileHash)
      .limit(1)
      .maybeSingle()

    if (existingDuplicate) {
      return NextResponse.json(
        {
          duplicate: true,
          existingSurvey: existingDuplicate,
          message: `Este arquivo já foi carregado anteriormente como "${existingDuplicate.name}" (${existingDuplicate.original_filename}).`,
        },
        { status: 409 }
      )
    }

    // Upload to Supabase Storage
    const storagePath = `surveys/${cohortId}/${Date.now()}_${file.name}`
    const { error: storageError } = await supabase.storage
      .from('uploads')
      .upload(storagePath, buffer, {
        contentType: file.type || 'application/octet-stream',
      })

    if (storageError) {
      console.error('Storage error:', storageError)
      return NextResponse.json(
        { error: `Erro ao salvar arquivo: ${storageError.message}` },
        { status: 500 }
      )
    }

    // Parse the file
    const parsed = parseFile(buffer, file.name)

    // Detect checkbox groups
    const checkboxGroups = detectCheckboxGroups(parsed.headers, parsed.rows)

    // Detect source platform
    let sourcePlatform: string | null = null
    const headersStr = parsed.headers.join(' ').toLowerCase()
    if (headersStr.includes('{{field:') || headersStr.includes('typeform')) {
      sourcePlatform = 'typeform'
    } else if (headersStr.includes('endereço de e-mail') || headersStr.includes('carimbo de data')) {
      sourcePlatform = 'google_forms'
    }

    // Create survey record
    const { data: survey, error: surveyError } = await supabase
      .from('surveys')
      .insert({
        cohort_id: cohortId,
        name: surveyName,
        original_filename: file.name,
        survey_type: surveyType,
        source_platform: sourcePlatform,
        total_rows: parsed.totalRows,
        status: 'uploaded',
        storage_path: storagePath,
        file_hash: fileHash,
      })
      .select()
      .single()

    if (surveyError) {
      return NextResponse.json(
        { error: `Erro ao criar pesquisa: ${surveyError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      survey,
      preview: {
        headers: parsed.headers,
        previewRows: parsed.previewRows,
        totalRows: parsed.totalRows,
        stats: parsed.stats,
        checkboxGroups,
        sourcePlatform,
      },
    })
  } catch (err) {
    console.error('Upload error:', err)
    return NextResponse.json(
      { error: 'Erro interno no processamento do arquivo' },
      { status: 500 }
    )
  }
}

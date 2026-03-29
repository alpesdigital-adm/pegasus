import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseFile } from '@/lib/parsers/csv-xlsx'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const cohortId = formData.get('cohort_id') as string | null

    if (!file || !cohortId) {
      return NextResponse.json(
        { error: 'Required fields: file, cohort_id' },
        { status: 400 }
      )
    }

    // Validate file type
    const filename = file.name.toLowerCase()
    if (!filename.endsWith('.csv') && !filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      return NextResponse.json(
        { error: 'Unsupported format. Use CSV, XLSX, or XLS.' },
        { status: 400 }
      )
    }

    // Get user's org_id for access control
    const { data: userProfile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Verify access to cohort via cohort -> product -> org chain
    const { data: cohort } = await supabase
      .from('cohorts')
      .select('product_id')
      .eq('id', cohortId)
      .single()

    if (!cohort) {
      return NextResponse.json({ error: 'Cohort not found' }, { status: 404 })
    }

    const { data: product } = await supabase
      .from('products')
      .select('org_id')
      .eq('id', cohort.product_id)
      .single()

    if (!product || product.org_id !== userProfile.org_id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Read and parse file
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const parsed = parseFile(buffer, file.name)

    // Find email column (case-insensitive, flexible matching)
    const emailColumnIndex = parsed.headers.findIndex((header) =>
      /email|e-mail|correo|mail/i.test(header)
    )

    if (emailColumnIndex === -1) {
      return NextResponse.json(
        { error: 'CSV must contain an email column' },
        { status: 400 }
      )
    }

    // Extract emails from CSV
    const emailsInFile = new Set<string>()
    const normalizedEmails: string[] = []

    for (const row of parsed.rows) {
      const email = (row[emailColumnIndex] || '').trim().toLowerCase()
      if (email && email.includes('@')) {
        emailsInFile.add(email)
        normalizedEmails.push(email)
      }
    }

    const totalInFile = emailsInFile.size

    if (totalInFile === 0) {
      return NextResponse.json(
        { error: 'No valid emails found in CSV' },
        { status: 400 }
      )
    }

    // Get all respondents in the cohort with their emails
    const { data: respondentsInCohort } = await supabase
      .from('respondents')
      .select('id, email')
      .eq('cohort_id', cohortId)

    if (!respondentsInCohort) {
      return NextResponse.json(
        { error: 'Failed to fetch respondents' },
        { status: 500 }
      )
    }

    // Match emails and collect IDs to update
    const notFound: string[] = []
    const idsToUpdate: string[] = []
    const matchedEmails = new Set<string>()

    for (const email of emailsInFile) {
      const matching = respondentsInCohort.find(
        (r) => (r.email || '').toLowerCase() === email
      )

      if (matching) {
        idsToUpdate.push(matching.id)
        matchedEmails.add(email)
      } else {
        notFound.push(email)
      }
    }

    const matched = matchedEmails.size

    // Update respondents to mark as buyers
    if (idsToUpdate.length > 0) {
      const { error: updateError } = await supabase
        .from('respondents')
        .update({ is_buyer: true })
        .in('id', idsToUpdate)

      if (updateError) {
        console.error('Bulk update error:', updateError)
        return NextResponse.json(
          { error: `Failed to update respondents: ${updateError.message}` },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      matched,
      total_in_file: totalInFile,
      not_found: notFound,
    })
  } catch (err) {
    console.error('Buyers bulk upload error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

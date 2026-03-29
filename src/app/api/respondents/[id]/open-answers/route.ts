import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: respondentId } = await params
    const supabase = await createClient()

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get respondent to verify access
    const { data: respondent } = await supabase
      .from('respondents')
      .select('cohort_id')
      .eq('id', respondentId)
      .single()

    if (!respondent) {
      return NextResponse.json({ error: 'Respondent not found' }, { status: 404 })
    }

    // Verify access to cohort
    const { data: userProfile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const { data: cohort } = await supabase
      .from('cohorts')
      .select('product_id')
      .eq('id', respondent.cohort_id)
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

    // Fetch open-ended answers for this respondent
    const { data: openAnswers, error } = await supabase
      .from('respondent_answers_open')
      .select(
        `
        id,
        respondent_id,
        column_id,
        value,
        survey_columns:column_id (
          id,
          original_header,
          normalized_header
        )
      `
      )
      .eq('respondent_id', respondentId)

    if (error) {
      console.error('Open answers query error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch open answers' },
        { status: 500 }
      )
    }

    // Transform to { "question": "answer" } format
    const answers: Record<string, string> = {}
    if (openAnswers && Array.isArray(openAnswers)) {
      openAnswers.forEach((answer: any) => {
        const columnName =
          answer.survey_columns?.normalized_header ||
          answer.survey_columns?.original_header ||
          `Column ${answer.column_id}`
        answers[columnName] = answer.value || ''
      })
    }

    return NextResponse.json({
      respondent_id: respondentId,
      answers,
    })
  } catch (err) {
    console.error('Open answers API error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

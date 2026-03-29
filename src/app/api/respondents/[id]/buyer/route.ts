import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get respondent ID from route params
    const { id: respondentId } = await params

    if (!respondentId) {
      return NextResponse.json(
        { error: 'Missing respondent ID' },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { is_buyer, buyer_product, buyer_date } = body

    if (typeof is_buyer !== 'boolean') {
      return NextResponse.json(
        { error: 'Field is_buyer must be a boolean' },
        { status: 400 }
      )
    }

    // Get user's org_id
    const { data: userProfile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Get respondent with cohort info to verify access
    const { data: respondent } = await supabase
      .from('respondents')
      .select('id, cohort_id')
      .eq('id', respondentId)
      .single()

    if (!respondent) {
      return NextResponse.json({ error: 'Respondent not found' }, { status: 404 })
    }

    // Verify access via cohort -> product -> org chain
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

    // Build update payload
    const updateData: Record<string, any> = { is_buyer }

    if (buyer_product) {
      updateData.buyer_product = buyer_product
    }

    if (buyer_date) {
      updateData.buyer_date = buyer_date
    }

    // Update respondent
    const { data: updated, error: updateError } = await supabase
      .from('respondents')
      .update(updateData)
      .eq('id', respondentId)
      .select()
      .single()

    if (updateError) {
      console.error('Update error:', updateError)
      return NextResponse.json(
        { error: `Failed to update respondent: ${updateError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json(updated)
  } catch (err) {
    console.error('Buyer toggle error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

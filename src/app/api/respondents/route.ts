import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const cohortId = searchParams.get('cohort_id')
    const page = parseInt(searchParams.get('page') || '1', 10)
    const perPage = parseInt(searchParams.get('per_page') || '50', 10)
    const search = searchParams.get('search')
    const sort = searchParams.get('sort') || 'name'
    const dir = (searchParams.get('dir') || 'asc').toLowerCase() as 'asc' | 'desc'

    // Validate required params
    if (!cohortId) {
      return NextResponse.json(
        { error: 'Missing cohort_id parameter' },
        { status: 400 }
      )
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

    // Calculate offset for pagination
    const offset = (page - 1) * perPage

    // Build query for respondents
    let respondentsQuery = supabase
      .from('respondents')
      .select('*', { count: 'exact' })
      .eq('cohort_id', cohortId)

    // Add search filter if provided
    if (search) {
      respondentsQuery = respondentsQuery.or(`email.ilike.%${search}%,name.ilike.%${search}%`)
    }

    // Apply sorting and pagination
    respondentsQuery = respondentsQuery
      .order(sort, { ascending: dir === 'asc' })
      .range(offset, offset + perPage - 1)

    const { data, error, count: total } = await respondentsQuery

    if (error) {
      console.error('Respondents query error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch respondents' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      data: data || [],
      total: total || 0,
      page,
      per_page: perPage,
    })
  } catch (err) {
    console.error('Respondents API error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

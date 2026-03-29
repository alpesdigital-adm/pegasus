import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/products/prerequisites?productId=xxx
 * Returns the list of prerequisite products for a given product.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const productId = request.nextUrl.searchParams.get('productId')
    if (!productId) return NextResponse.json({ error: 'productId obrigatório' }, { status: 400 })

    const { data, error } = await supabase
      .from('product_prerequisites')
      .select('prerequisite_product_id, products!product_prerequisites_prerequisite_product_id_fkey(id, name, slug)')
      .eq('product_id', productId)

    if (error) throw error

    const prerequisites = (data || []).map((row) => ({
      productId: (row as Record<string, unknown>).prerequisite_product_id,
      ...(row as Record<string, unknown>).products as Record<string, unknown>,
    }))

    return NextResponse.json({ prerequisites })
  } catch (err) {
    console.error('Prerequisites GET error:', err)
    return NextResponse.json(
      { error: `Erro ao buscar pré-requisitos: ${err instanceof Error ? err.message : 'desconhecido'}` },
      { status: 500 }
    )
  }
}

/**
 * POST /api/products/prerequisites
 * Set prerequisites for a product (replaces all existing).
 * Body: { productId, prerequisiteProductIds: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body = await request.json()
    const { productId, prerequisiteProductIds } = body as {
      productId: string
      prerequisiteProductIds: string[]
    }

    if (!productId) return NextResponse.json({ error: 'productId obrigatório' }, { status: 400 })

    // Delete existing prerequisites
    await supabase
      .from('product_prerequisites')
      .delete()
      .eq('product_id', productId)

    // Insert new ones
    if (prerequisiteProductIds && prerequisiteProductIds.length > 0) {
      const rows = prerequisiteProductIds
        .filter((id) => id !== productId) // prevent self-reference
        .map((prereqId) => ({
          product_id: productId,
          prerequisite_product_id: prereqId,
        }))

      if (rows.length > 0) {
        const { error } = await supabase
          .from('product_prerequisites')
          .insert(rows)

        if (error) throw error
      }
    }

    return NextResponse.json({ saved: prerequisiteProductIds?.length || 0 })
  } catch (err) {
    console.error('Prerequisites POST error:', err)
    return NextResponse.json(
      { error: `Erro ao salvar pré-requisitos: ${err instanceof Error ? err.message : 'desconhecido'}` },
      { status: 500 }
    )
  }
}

'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Settings, Plus, X, Loader2, CheckCircle2, Package } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProductInfo {
  id: string
  name: string
  slug: string
  expert_name: string | null
  description: string | null
}

interface PrereqProduct {
  id: string
  name: string
  slug: string
}

export default function ProductSettingsPage() {
  const params = useParams()
  const { orgSlug, productSlug } = params as { orgSlug: string; productSlug: string }

  const [product, setProduct] = useState<ProductInfo | null>(null)
  const [allProducts, setAllProducts] = useState<PrereqProduct[]>([])
  const [prerequisites, setPrerequisites] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase.from('users').select('org_id').eq('id', user.id).single()
    if (!profile) return

    const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).eq('id', profile.org_id).single()
    if (!org) return

    // Load current product
    const { data: prod } = await supabase
      .from('products')
      .select('id, name, slug, expert_name, description')
      .eq('org_id', org.id)
      .eq('slug', productSlug)
      .single()

    if (!prod) return
    setProduct(prod)

    // Load all other products for prereq selection
    const { data: prods } = await supabase
      .from('products')
      .select('id, name, slug')
      .eq('org_id', org.id)
      .neq('id', prod.id)
      .order('name')

    setAllProducts(prods || [])

    // Load existing prerequisites
    const res = await fetch(`/api/products/prerequisites?productId=${prod.id}`)
    if (res.ok) {
      const data = await res.json()
      setPrerequisites((data.prerequisites || []).map((p: { productId: string }) => p.productId))
    }

    setLoading(false)
  }

  async function savePrerequisites() {
    if (!product) return
    setSaving(true)
    setSaved(false)

    await fetch('/api/products/prerequisites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: product.id,
        prerequisiteProductIds: prerequisites,
      }),
    })

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function togglePrereq(productId: string) {
    setPrerequisites((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    )
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
      </div>
    )
  }

  if (!product) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center text-gray-500">
        Produto não encontrado.
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="w-5 h-5 text-gray-400" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Configurações do produto</h1>
          <p className="text-sm text-gray-500">{product.name}</p>
        </div>
      </div>

      {/* Prerequisites section */}
      <div className="bg-white rounded-xl border p-6 mb-6">
        <h2 className="font-semibold text-gray-900 mb-1">Pré-requisitos de compra</h2>
        <p className="text-sm text-gray-500 mb-4">
          Defina quais produtos o lead precisa ter comprado antes de poder comprar este.
          Isso será usado como critério obrigatório de qualificação no motor ICP.
        </p>

        {allProducts.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">
            Nenhum outro produto cadastrado na organização.
            Crie outros produtos para definir pré-requisitos.
          </p>
        ) : (
          <div className="space-y-2 mb-4">
            {allProducts.map((p) => {
              const isSelected = prerequisites.includes(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => togglePrereq(p.id)}
                  className={cn(
                    'flex items-center w-full px-4 py-3 rounded-lg border text-left transition-colors',
                    isSelected
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <Package className={cn('w-4 h-4 mr-3', isSelected ? 'text-emerald-600' : 'text-gray-400')} />
                  <span className={cn('text-sm font-medium', isSelected ? 'text-emerald-900' : 'text-gray-700')}>
                    {p.name}
                  </span>
                  {isSelected && (
                    <span className="ml-auto text-xs text-emerald-600 font-medium">Pré-requisito ✓</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {prerequisites.length > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            {prerequisites.length === 1 ? 'O lead precisará' : 'O lead precisará'} ter comprado {prerequisites.length === 1 ? 'o produto acima' : `os ${prerequisites.length} produtos acima`} para
            ser considerado plenamente qualificado para {product.name}.
          </p>
        )}

        <button
          onClick={savePrerequisites}
          disabled={saving}
          className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Salvando...
            </>
          ) : saved ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Salvo!
            </>
          ) : (
            'Salvar pré-requisitos'
          )}
        </button>
      </div>
    </div>
  )
}

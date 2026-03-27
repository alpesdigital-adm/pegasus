'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

type Step = 'org' | 'product' | 'cohort'

export default function OnboardingPage() {
  const searchParams = useSearchParams()
  const initialStep = (searchParams.get('step') as Step) || 'org'
  const preselectedProductId = searchParams.get('product') || null

  const [step, setStep] = useState<Step>(initialStep)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Org fields
  const [orgName, setOrgName] = useState('')

  // Product fields
  const [productName, setProductName] = useState('')
  const [expertName, setExpertName] = useState('')
  const [productDescription, setProductDescription] = useState('')

  // Cohort fields
  const [cohortName, setCohortName] = useState('')
  const [cohortType, setCohortType] = useState<string>('launch')
  const [cohortStatus, setCohortStatus] = useState<string>('planning')
  const [selectedProductId, setSelectedProductId] = useState<string>(preselectedProductId || '')

  const router = useRouter()
  const supabase = createClient()

  // Check if user already has org
  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('users')
        .select('org_id')
        .eq('id', user.id)
        .single()

      if (profile?.org_id && step === 'org') {
        setStep('product')
      }
    }
    check()
  }, [])

  function slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
  }

  async function createOrg() {
    setLoading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const slug = slugify(orgName)

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({ name: orgName, slug })
      .select()
      .single()

    if (orgError) {
      setError(orgError.message)
      setLoading(false)
      return
    }

    // Create user profile linked to org
    const { error: userError } = await supabase
      .from('users')
      .upsert({
        id: user.id,
        org_id: org.id,
        email: user.email!,
        name: user.user_metadata?.name || user.email!.split('@')[0],
        role: 'owner',
      })

    if (userError) {
      setError(userError.message)
      setLoading(false)
      return
    }

    setLoading(false)
    setStep('product')
  }

  async function createProduct() {
    setLoading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      setError('Organização não encontrada.')
      setLoading(false)
      return
    }

    const slug = slugify(productName)

    const { data: product, error: prodError } = await supabase
      .from('products')
      .insert({
        org_id: profile.org_id,
        name: productName,
        expert_name: expertName || null,
        slug,
        description: productDescription || null,
      })
      .select()
      .single()

    if (prodError) {
      setError(prodError.message)
      setLoading(false)
      return
    }

    setSelectedProductId(product.id)
    setLoading(false)
    setStep('cohort')
  }

  async function createCohort() {
    setLoading(true)
    setError(null)

    const productId = selectedProductId || preselectedProductId
    if (!productId) {
      setError('Nenhum produto selecionado.')
      setLoading(false)
      return
    }

    const slug = slugify(cohortName)

    const { error: cohortError } = await supabase
      .from('cohorts')
      .insert({
        product_id: productId,
        name: cohortName,
        slug,
        type: cohortType,
        status: cohortStatus,
      })

    if (cohortError) {
      setError(cohortError.message)
      setLoading(false)
      return
    }

    setLoading(false)
    router.push('/')
    router.refresh()
  }

  const steps = [
    { key: 'org', label: 'Organização' },
    { key: 'product', label: 'Produto' },
    { key: 'cohort', label: 'Turma' },
  ]

  const currentStepIndex = steps.findIndex((s) => s.key === step)

  return (
    <div className="max-w-lg mx-auto py-12">
      {/* Progress */}
      <div className="flex items-center justify-center gap-2 mb-10">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                i <= currentStepIndex
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-sm ${i <= currentStepIndex ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="w-8 h-px bg-gray-300" />}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border p-8">
        {/* Step: Organization */}
        {step === 'org' && (
          <>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Crie sua organização</h2>
            <p className="text-gray-500 text-sm mb-6">
              A organização é o espaço que abriga seus produtos e turmas.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome da organização
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Ex: RAT Academy, Alpes Digital"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}
              <button
                onClick={createOrg}
                disabled={loading || !orgName.trim()}
                className="w-full py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Criando...' : 'Continuar'}
              </button>
            </div>
          </>
        )}

        {/* Step: Product */}
        {step === 'product' && (
          <>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Crie seu primeiro produto</h2>
            <p className="text-gray-500 text-sm mb-6">
              Um produto representa uma formação, curso ou programa do especialista.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome do produto
                </label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="Ex: RAT Academy, ComuniCAR, GPS Empresário"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome do especialista <span className="text-gray-400">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={expertName}
                  onChange={(e) => setExpertName(e.target.value)}
                  placeholder="Ex: Dra. Priscila Barreto"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição <span className="text-gray-400">(opcional)</span>
                </label>
                <textarea
                  value={productDescription}
                  onChange={(e) => setProductDescription(e.target.value)}
                  placeholder="Breve descrição do produto..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}
              <button
                onClick={createProduct}
                disabled={loading || !productName.trim()}
                className="w-full py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Criando...' : 'Continuar'}
              </button>
            </div>
          </>
        )}

        {/* Step: Cohort */}
        {step === 'cohort' && (
          <>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Crie sua primeira turma</h2>
            <p className="text-gray-500 text-sm mb-6">
              Uma turma é uma edição ou lançamento do produto (ex: Turma 6, IM2603).
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome da turma
                </label>
                <input
                  type="text"
                  value={cohortName}
                  onChange={(e) => setCohortName(e.target.value)}
                  placeholder="Ex: Turma 6, T6, IM2603"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo
                </label>
                <select
                  value={cohortType}
                  onChange={(e) => setCohortType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                >
                  <option value="launch">Lançamento</option>
                  <option value="evergreen">Perpétuo (Evergreen)</option>
                  <option value="live_event">Evento ao vivo</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={cohortStatus}
                  onChange={(e) => setCohortStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                >
                  <option value="planning">Planejamento</option>
                  <option value="capturing">Captação</option>
                  <option value="live">Ao vivo</option>
                  <option value="selling">Vendas</option>
                  <option value="closed">Encerrado</option>
                </select>
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}
              <button
                onClick={createCohort}
                disabled={loading || !cohortName.trim()}
                className="w-full py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Criando...' : 'Concluir setup'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

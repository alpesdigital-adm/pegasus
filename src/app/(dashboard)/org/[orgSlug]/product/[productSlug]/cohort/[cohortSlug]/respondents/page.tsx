import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { RespondentsGrid } from './respondents-grid'
import { BuyersUpload } from './buyers-upload'

interface Props {
  params: Promise<{
    orgSlug: string
    productSlug: string
    cohortSlug: string
  }>
}

export default async function RespondentsPage({ params }: Props) {
  const { orgSlug, productSlug, cohortSlug } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: userProfile } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!userProfile) notFound()

  // Find org
  const { data: org } = await supabase
    .from('organizations')
    .select('*')
    .eq('slug', orgSlug)
    .eq('id', userProfile.org_id)
    .single()

  if (!org) notFound()

  // Find product
  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('org_id', org.id)
    .eq('slug', productSlug)
    .single()

  if (!product) notFound()

  // Find cohort
  const { data: cohort } = await supabase
    .from('cohorts')
    .select('*')
    .eq('product_id', product.id)
    .eq('slug', cohortSlug)
    .single()

  if (!cohort) notFound()

  const basePath = `/org/${orgSlug}/product/${productSlug}/cohort/${cohortSlug}`

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 mb-4">
        <span>{org.name}</span>
        <span className="mx-2">/</span>
        <span>{product.name}</span>
        <span className="mx-2">/</span>
        <span>{cohort.name}</span>
        <span className="mx-2">/</span>
        <span className="text-gray-900 font-medium">Respondentes</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Respondentes</h1>
          <p className="text-sm text-gray-500 mt-1">Explore e filtre todos os respondentes da turma</p>
        </div>
        <div className="flex items-center gap-3">
          <BuyersUpload cohortId={cohort.id} />
          <Link
            href={`${basePath}/import`}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
          >
            Importar pesquisa
          </Link>
        </div>
      </div>

      {/* Grid */}
      <RespondentsGrid cohortId={cohort.id} basePath={basePath} />
    </div>
  )
}

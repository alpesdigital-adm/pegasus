import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Upload, Users, BarChart3, FileText, MessageSquare } from 'lucide-react'

interface Props {
  params: Promise<{
    orgSlug: string
    productSlug: string
    cohortSlug: string
  }>
}

export default async function CohortPage({ params }: Props) {
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

  // Counts — only fully processed surveys
  const { count: surveysCount } = await supabase
    .from('surveys')
    .select('*', { count: 'exact', head: true })
    .eq('cohort_id', cohort.id)
    .eq('status', 'done')

  const { count: respondentsCount } = await supabase
    .from('respondents')
    .select('*', { count: 'exact', head: true })
    .eq('cohort_id', cohort.id)

  const statusLabels: Record<string, string> = {
    planning: 'Planejamento',
    capturing: 'Captação',
    live: 'Ao vivo',
    selling: 'Vendas',
    closed: 'Encerrado',
  }

  const statusColors: Record<string, string> = {
    planning: 'bg-gray-100 text-gray-700',
    capturing: 'bg-blue-100 text-blue-700',
    live: 'bg-emerald-100 text-emerald-700',
    selling: 'bg-amber-100 text-amber-700',
    closed: 'bg-gray-100 text-gray-500',
  }

  const basePath = `/org/${orgSlug}/product/${productSlug}/cohort/${cohortSlug}`

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 mb-4">
        <span>{org.name}</span>
        <span className="mx-2">/</span>
        <span>{product.name}</span>
        <span className="mx-2">/</span>
        <span className="text-gray-900 font-medium">{cohort.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cohort.name}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[cohort.status]}`}>
              {statusLabels[cohort.status]}
            </span>
            {product.expert_name && (
              <span className="text-sm text-gray-500">{product.expert_name}</span>
            )}
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-gray-500">Pesquisas</p>
          <p className="text-2xl font-bold text-gray-900">{surveysCount || 0}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-gray-500">Respondentes</p>
          <p className="text-2xl font-bold text-gray-900">{respondentsCount || 0}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-gray-500">Score ICP médio</p>
          <p className="text-2xl font-bold text-gray-900">—</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-gray-500">Alertas ativos</p>
          <p className="text-2xl font-bold text-gray-900">0</p>
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ActionCard
          href={`${basePath}/import`}
          icon={Upload}
          title="Importar pesquisa"
          description="Upload de CSV/XLSX com classificação inteligente"
        />
        <ActionCard
          href={`${basePath}/respondents`}
          icon={Users}
          title="Respondentes"
          description="Explorar e filtrar todos os respondentes"
        />
        <ActionCard
          href={`${basePath}/analytics`}
          icon={BarChart3}
          title="Analytics"
          description="Distribuições, scores e insights"
        />
      </div>
    </div>
  )
}

function ActionCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="bg-white rounded-xl border p-5 hover:border-emerald-300 hover:shadow-sm transition-all group"
    >
      <Icon className="w-6 h-6 text-emerald-600 mb-3 group-hover:scale-110 transition-transform" />
      <h3 className="text-sm font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-xs text-gray-500">{description}</p>
    </Link>
  )
}

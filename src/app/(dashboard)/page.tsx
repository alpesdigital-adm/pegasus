import { createClient } from '@/lib/supabase/server'
import { BarChart3, Users, Upload, TrendingUp } from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user!.id)
    .single()

  const { data: products } = await supabase
    .from('products')
    .select('id')
    .eq('org_id', userProfile!.org_id)

  const productIds = products?.map((p) => p.id) || []

  let totalCohorts = 0
  let totalRespondents = 0

  if (productIds.length > 0) {
    const { count: cohortsCount } = await supabase
      .from('cohorts')
      .select('*', { count: 'exact', head: true })
      .in('product_id', productIds)
    totalCohorts = cohortsCount || 0

    if (totalCohorts > 0) {
      const { data: cohorts } = await supabase
        .from('cohorts')
        .select('id')
        .in('product_id', productIds)

      const cohortIds = cohorts?.map((c) => c.id) || []
      if (cohortIds.length > 0) {
        const { count: respondentsCount } = await supabase
          .from('respondents')
          .select('*', { count: 'exact', head: true })
          .in('cohort_id', cohortIds)
        totalRespondents = respondentsCount || 0
      }
    }
  }

  const stats = [
    {
      label: 'Produtos',
      value: productIds.length,
      icon: BarChart3,
      color: 'text-emerald-600 bg-emerald-50',
    },
    {
      label: 'Turmas',
      value: totalCohorts,
      icon: Upload,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      label: 'Respondentes',
      value: totalRespondents,
      icon: Users,
      color: 'text-violet-600 bg-violet-50',
    },
    {
      label: 'Score ICP médio',
      value: '—',
      icon: TrendingUp,
      color: 'text-amber-600 bg-amber-50',
    },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Olá, {userProfile?.name?.split(' ')[0] || 'Usuário'}
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Visão geral do seu workspace
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border p-5 flex items-start gap-4"
          >
            <div className={`p-2.5 rounded-lg ${stat.color}`}>
              <stat.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-sm text-gray-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {productIds.length === 0 && (
        <div className="bg-white rounded-xl border p-8 text-center">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Upload className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Comece importando dados
          </h2>
          <p className="text-gray-500 text-sm max-w-md mx-auto mb-4">
            Crie seu primeiro produto e turma, depois importe uma pesquisa CSV para ver a inteligência do Pegasus em ação.
          </p>
          <a
            href="/onboarding?step=product"
            className="inline-flex items-center px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
          >
            Criar primeiro produto
          </a>
        </div>
      )}
    </div>
  )
}

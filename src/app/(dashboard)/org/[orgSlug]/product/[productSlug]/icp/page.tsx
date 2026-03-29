'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Loader2,
  Sparkles,
  RefreshCw,
  Users,
  TrendingUp,
  Target,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  BarChart3,
} from 'lucide-react'
import { cn, formatHeader } from '@/lib/utils'

interface ClosedRule {
  columnId: string
  header: string
  semanticCategory: string | null
  matchValues: string[]
  weight: number
  type: 'must_match' | 'prefer' | 'strong_signal'
  buyerPercentage: number
}

interface Avatar {
  id: string
  name: string
  description: string
  source: string
  avatarIndex: number
  conversionProbability: number
  buyerCount: number
  totalMatchCount: number
  buyerCoverage: number
  closedRules: ClosedRule[]
  treeConditions: { columnId: string; header: string; operator: string; values: string[] }[]
  createdAt: string
}

interface ScoreStats {
  avgScore: number
  medianScore: number
  distribution: { range: string; count: number; percentage: number }[]
  aboveThreshold: { threshold: number; count: number; percentage: number }[]
}

const RULE_TYPE_LABELS: Record<string, string> = {
  must_match: 'Obrigatório',
  prefer: 'Preferencial',
  strong_signal: 'Sinal forte',
}

const RULE_TYPE_COLORS: Record<string, string> = {
  must_match: 'bg-red-100 text-red-700',
  prefer: 'bg-blue-100 text-blue-700',
  strong_signal: 'bg-emerald-100 text-emerald-700',
}

export default function ICPPage() {
  const params = useParams()
  const { orgSlug, productSlug } = params as { orgSlug: string; productSlug: string }

  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [productId, setProductId] = useState<string | null>(null)
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [expandedAvatar, setExpandedAvatar] = useState<number | null>(null)
  const [scoreStats, setScoreStats] = useState<ScoreStats | null>(null)
  const [buyerCount, setBuyerCount] = useState(0)
  const [respondentCount, setRespondentCount] = useState(0)

  const supabase = createClient()

  const resolveProductId = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data: profile } = await supabase.from('users').select('org_id').eq('id', user.id).single()
    if (!profile) return null
    const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).eq('id', profile.org_id).single()
    if (!org) return null
    const { data: product } = await supabase.from('products').select('id').eq('org_id', org.id).eq('slug', productSlug).single()
    if (!product) return null
    return product.id
  }, [orgSlug, productSlug, supabase])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const pId = productId || await resolveProductId()
    if (!pId) {
      setError('Produto não encontrado')
      setLoading(false)
      return
    }
    setProductId(pId)

    // Load avatars
    const res = await fetch(`/api/icp/profiles?productId=${pId}`)
    const data = await res.json()
    if (res.ok) {
      setAvatars(data.avatars || [])
      if (data.avatars?.length > 0) {
        setExpandedAvatar(data.avatars[0].avatarIndex)
      }
    }

    // Load buyer/respondent counts
    const { data: cohorts } = await supabase.from('cohorts').select('id').eq('product_id', pId)
    if (cohorts && cohorts.length > 0) {
      const cohortIds = cohorts.map((c) => c.id)
      const { count: totalResp } = await supabase
        .from('respondents')
        .select('*', { count: 'exact', head: true })
        .in('cohort_id', cohortIds)

      const { count: totalBuyers } = await supabase
        .from('respondents')
        .select('*', { count: 'exact', head: true })
        .in('cohort_id', cohortIds)
        .eq('is_buyer', true)

      setRespondentCount(totalResp || 0)
      setBuyerCount(totalBuyers || 0)
    }

    setLoading(false)
  }, [productId, resolveProductId, supabase])

  useEffect(() => {
    loadData()
  }, [])

  async function handleGenerate() {
    if (!productId) return
    setGenerating(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/icp/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error)
        setGenerating(false)
        return
      }

      setSuccess(data.message)
      await loadData()
    } catch {
      setError('Erro ao gerar perfil ICP')
    }
    setGenerating(false)
  }

  async function handleScore() {
    if (!productId) return
    setScoring(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/icp/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error)
        setScoring(false)
        return
      }

      setScoreStats(data.stats)
      setSuccess(`${data.scored} respondentes scorados com sucesso.`)
    } catch {
      setError('Erro ao calcular scores')
    }
    setScoring(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Perfil ICP</h1>
          <p className="text-sm text-gray-500">Avatares gerados por análise de compradores</p>
        </div>
        <div className="flex items-center gap-2">
          {avatars.length > 0 && (
            <button
              onClick={handleScore}
              disabled={scoring}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors"
            >
              {scoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
              {scoring ? 'Scorando...' : 'Scorar respondentes'}
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating || buyerCount < 10}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            title={buyerCount < 10 ? `Mínimo 10 compradores (atual: ${buyerCount})` : ''}
          >
            {generating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : avatars.length > 0 ? (
              <RefreshCw className="w-4 h-4" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {generating ? 'Gerando...' : avatars.length > 0 ? 'Regenerar' : 'Gerar ICP'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-6 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 mb-6 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
            <Users className="w-3.5 h-3.5" />
            Respondentes
          </div>
          <p className="text-2xl font-bold text-gray-900">{respondentCount.toLocaleString('pt-BR')}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
            <Target className="w-3.5 h-3.5" />
            Compradores
          </div>
          <p className="text-2xl font-bold text-gray-900">{buyerCount.toLocaleString('pt-BR')}</p>
          <p className="text-xs text-gray-400">
            {respondentCount > 0 ? `${((buyerCount / respondentCount) * 100).toFixed(1)}% de conversão` : ''}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
            <TrendingUp className="w-3.5 h-3.5" />
            Avatares
          </div>
          <p className="text-2xl font-bold text-gray-900">{avatars.length}</p>
        </div>
      </div>

      {/* Score histogram */}
      {scoreStats && (
        <div className="bg-white rounded-xl border p-5 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">Distribuição de scores</h2>
          <div className="flex items-end gap-2 h-32 mb-2">
            {scoreStats.distribution.map((d) => {
              const maxPct = Math.max(...scoreStats.distribution.map((x) => x.percentage))
              const barHeight = maxPct > 0 ? (d.percentage / maxPct) * 100 : 0
              const colors: Record<string, string> = {
                '0-20': 'bg-red-400',
                '21-40': 'bg-orange-400',
                '41-60': 'bg-yellow-400',
                '61-80': 'bg-emerald-400',
                '81-100': 'bg-emerald-600',
              }
              return (
                <div key={d.range} className="flex-1 flex flex-col items-center">
                  <span className="text-xs text-gray-500 mb-1">{d.count}</span>
                  <div
                    className={cn('w-full rounded-t', colors[d.range] || 'bg-gray-300')}
                    style={{ height: `${Math.max(barHeight, 2)}%` }}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex gap-2">
            {scoreStats.distribution.map((d) => (
              <div key={d.range} className="flex-1 text-center text-xs text-gray-500">
                {d.range}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-6 mt-4 pt-3 border-t text-sm">
            <span className="text-gray-500">
              Média: <span className="font-medium text-gray-900">{scoreStats.avgScore}</span>
            </span>
            <span className="text-gray-500">
              Mediana: <span className="font-medium text-gray-900">{scoreStats.medianScore}</span>
            </span>
            {scoreStats.aboveThreshold.map((t) => (
              <span key={t.threshold} className="text-gray-500">
                ≥{t.threshold}: <span className="font-medium text-gray-900">{t.percentage}%</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {avatars.length === 0 && !generating && (
        <div className="bg-white rounded-xl border p-12 text-center">
          <Sparkles className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Nenhum perfil ICP gerado</h2>
          <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
            {buyerCount < 10
              ? `Você precisa de pelo menos 10 compradores marcados para gerar o perfil ICP. Atualmente: ${buyerCount}.`
              : 'Clique em "Gerar ICP" para analisar os compradores e criar avatares automaticamente.'}
          </p>
        </div>
      )}

      {/* Avatar cards */}
      {avatars.length > 0 && (
        <div className="space-y-4">
          {avatars.map((avatar) => {
            const isExpanded = expandedAvatar === avatar.avatarIndex
            return (
              <div key={avatar.id} className="bg-white rounded-xl border overflow-hidden">
                <button
                  onClick={() => setExpandedAvatar(isExpanded ? null : avatar.avatarIndex)}
                  className="flex items-center w-full px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 mr-3 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 mr-3 text-gray-400" />
                  )}
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{avatar.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{avatar.description}</p>
                  </div>
                  <div className="flex items-center gap-4 ml-4">
                    <div className="text-right">
                      <p className="text-lg font-bold text-emerald-600">
                        {(avatar.conversionProbability * 100).toFixed(0)}%
                      </p>
                      <p className="text-xs text-gray-400">prob. conversão</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">{avatar.buyerCount}</p>
                      <p className="text-xs text-gray-400">compradores</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">
                        {(avatar.buyerCoverage * 100).toFixed(0)}%
                      </p>
                      <p className="text-xs text-gray-400">cobertura</p>
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-5 border-t">
                    {/* Tree conditions */}
                    {avatar.treeConditions.length > 0 && (
                      <div className="mt-4 mb-4">
                        <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                          Critérios de segmentação
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {avatar.treeConditions.map((cond, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center px-2.5 py-1 bg-violet-50 text-violet-700 text-xs rounded-lg"
                            >
                              {formatHeader(cond.header)} {cond.operator === 'in' ? '=' : '≠'}{' '}
                              {cond.values.length <= 2
                                ? cond.values.join(' / ')
                                : `${cond.values.length} valores`}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Rules */}
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                      Regras de scoring ({avatar.closedRules.length})
                    </h4>
                    <div className="space-y-1.5">
                      {avatar.closedRules.map((rule, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-3 px-3 py-2.5 bg-gray-50 rounded-lg text-sm hover:bg-gray-100 transition-colors"
                        >
                          <span
                            className={cn(
                              'text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap mt-0.5',
                              RULE_TYPE_COLORS[rule.type]
                            )}
                          >
                            {RULE_TYPE_LABELS[rule.type]}
                          </span>
                          <span className="flex-1 text-gray-900 leading-snug">
                            {formatHeader(rule.header)}
                          </span>
                          <div className="flex items-center gap-3 shrink-0 mt-0.5">
                            <span className="text-gray-500 text-xs max-w-[200px] truncate" title={rule.matchValues.join(', ')}>
                              {rule.matchValues.length <= 2
                                ? rule.matchValues.join(', ')
                                : `${rule.matchValues.length} valores`}
                            </span>
                            <span className="text-xs text-gray-400 whitespace-nowrap">
                              {(rule.buyerPercentage * 100).toFixed(0)}%
                            </span>
                            <span className="text-xs font-medium text-gray-600 whitespace-nowrap">
                              peso {rule.weight}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

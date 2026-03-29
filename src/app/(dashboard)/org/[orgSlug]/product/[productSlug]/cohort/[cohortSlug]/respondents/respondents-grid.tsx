'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
import { Search, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Respondent } from '@/types/database'

interface RespondentsGridProps {
  cohortId: string
  basePath: string
}

interface RespondentsResponse {
  data: RespondentRow[]
  total: number
  page: number
  per_page: number
}

interface RespondentRow extends Respondent {
  survey_answers?: Record<string, string | number | boolean>
}

interface OpenAnswers {
  [key: string]: string
}

const ITEMS_PER_PAGE = 50

export function RespondentsGrid({ cohortId, basePath }: RespondentsGridProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [respondents, setRespondents] = useState<RespondentRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortColumn, setSortColumn] = useState<string>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [openAnswers, setOpenAnswers] = useState<Record<string, OpenAnswers>>({})
  const [loadingAnswers, setLoadingAnswers] = useState<Record<string, boolean>>({})

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null)
  const [searchInput, setSearchInput] = useState('')

  // Fetch respondents list
  useEffect(() => {
    async function fetchRespondents() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          cohort_id: cohortId,
          page: page.toString(),
          per_page: ITEMS_PER_PAGE.toString(),
          ...(searchTerm && { search: searchTerm }),
          ...(sortColumn && { sort: sortColumn, dir: sortDir }),
        })

        const res = await fetch(`/api/respondents?${params.toString()}`)
        if (!res.ok) {
          throw new Error('Falha ao carregar respondentes')
        }

        const data: RespondentsResponse = await res.json()
        setRespondents(data.data)
        setTotal(data.total)
        setPage(data.page)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar respondentes')
      } finally {
        setLoading(false)
      }
    }

    fetchRespondents()
  }, [cohortId, page, searchTerm, sortColumn, sortDir])

  // Fetch open answers for an expanded row
  async function fetchOpenAnswers(respondentId: string) {
    if (openAnswers[respondentId]) {
      return // Already fetched
    }

    setLoadingAnswers((prev) => ({ ...prev, [respondentId]: true }))
    try {
      const res = await fetch(`/api/respondents/${respondentId}/open-answers`)
      if (!res.ok) {
        throw new Error('Falha ao carregar respostas abertas')
      }

      const data = await res.json()
      setOpenAnswers((prev) => ({ ...prev, [respondentId]: data.answers || {} }))
    } catch (err) {
      console.error('Error fetching open answers:', err)
    } finally {
      setLoadingAnswers((prev) => ({ ...prev, [respondentId]: false }))
    }
  }

  function toggleExpanded(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
    } else {
      setExpandedId(id)
      fetchOpenAnswers(id)
    }
  }

  function handleSort(column: string) {
    if (sortColumn === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDir('asc')
    }
    setPage(1)
  }

  const columns = [
    { key: 'email', label: 'Email', sortable: true },
    { key: 'name', label: 'Nome', sortable: true },
    { key: 'phone', label: 'Telefone', sortable: false },
    { key: 'icp_score', label: 'Score', sortable: true },
    { key: 'is_buyer', label: 'Comprador', sortable: true },
    { key: 'temperature', label: 'Temperatura', sortable: true },
  ]

  // Loading state
  if (loading && respondents.length === 0) {
    return (
      <div className="bg-white rounded-xl border">
        <div className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Carregando respondentes...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="bg-white rounded-xl border">
        <div className="p-8 text-center">
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  // Empty state
  if (!loading && respondents.length === 0) {
    return (
      <div className="bg-white rounded-xl border">
        <div className="p-12 text-center">
          <p className="text-sm text-gray-500 mb-4">Nenhum respondente encontrado</p>
          {searchTerm && (
            <button
              onClick={() => { setSearchTerm(''); setSearchInput('') }}
              className="inline-flex px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-200 transition-colors"
            >
              Limpar busca
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border">
      {/* Search bar */}
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por email ou nome..."
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value)
              if (searchTimeout.current) clearTimeout(searchTimeout.current)
              searchTimeout.current = setTimeout(() => {
                setSearchTerm(e.target.value)
                setPage(1)
              }, 400)
            }}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50/50">
              <th className="w-8 px-4 py-3"></th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-left font-medium text-gray-700 text-xs',
                    col.sortable && 'cursor-pointer hover:bg-gray-100/50'
                  )}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <div className="flex items-center gap-1.5">
                    {col.label}
                    {col.sortable && (
                      <>
                        {sortColumn === col.key && (
                          <>
                            {sortDir === 'asc' ? (
                              <ChevronUp className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 text-emerald-600" />
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {respondents.map((respondent, idx) => {
              const isExpanded = expandedId === respondent.id
              const answers = openAnswers[respondent.id]
              const isLoadingAnswers = loadingAnswers[respondent.id]

              return (
                <Fragment key={respondent.id}>
                  <tr className={cn('border-b hover:bg-gray-50/50', isExpanded && 'bg-emerald-50/30')}>
                    <td className="w-8 px-4 py-3">
                      <button
                        onClick={() => toggleExpanded(respondent.id)}
                        className="p-1 rounded hover:bg-gray-200 text-gray-400"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-900 truncate" title={respondent.email}>
                      {respondent.email}
                    </td>
                    <td className="px-4 py-3 text-gray-700 truncate" title={respondent.name || ''}>
                      {respondent.name || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700 truncate" title={respondent.phone || ''}>
                      {respondent.phone || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {respondent.icp_score != null ? (
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-1 text-xs font-bold rounded-full',
                            Number(respondent.icp_score) >= 70 && 'bg-emerald-100 text-emerald-700',
                            Number(respondent.icp_score) >= 40 && Number(respondent.icp_score) < 70 && 'bg-amber-100 text-amber-700',
                            Number(respondent.icp_score) > 0 && Number(respondent.icp_score) < 40 && 'bg-red-100 text-red-700',
                            Number(respondent.icp_score) === 0 && 'bg-gray-100 text-gray-500'
                          )}
                          title={
                            respondent.icp_score_details
                              ? `Avatar: ${(respondent.icp_score_details as Record<string, unknown>).best_avatar_label || '—'}\nProb. conversão: ${(((respondent.icp_score_details as Record<string, unknown>).conversion_probability as number) * 100).toFixed(0)}%`
                              : ''
                          }
                        >
                          {Number(respondent.icp_score).toFixed(0)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          const newVal = !respondent.is_buyer
                          // Optimistic update
                          setRespondents(prev => prev.map(r => r.id === respondent.id ? { ...r, is_buyer: newVal } : r))
                          try {
                            const res = await fetch(`/api/respondents/${respondent.id}/buyer`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ is_buyer: newVal }),
                            })
                            if (!res.ok) throw new Error()
                          } catch {
                            // Revert on error
                            setRespondents(prev => prev.map(r => r.id === respondent.id ? { ...r, is_buyer: !newVal } : r))
                          }
                        }}
                        title="Clique para alternar"
                        className="cursor-pointer"
                      >
                        {respondent.is_buyer ? (
                          <span className="inline-flex px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full hover:bg-emerald-200 transition-colors">
                            Sim
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full hover:bg-gray-200 transition-colors">
                            Não
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {respondent.temperature ? (
                        <span
                          className={cn(
                            'inline-flex px-2 py-1 text-xs font-medium rounded-full',
                            respondent.temperature === 'cold' && 'bg-blue-100 text-blue-700',
                            respondent.temperature === 'warm' && 'bg-amber-100 text-amber-700',
                            respondent.temperature === 'hot' && 'bg-red-100 text-red-700'
                          )}
                        >
                          {respondent.temperature === 'cold' && 'Frio'}
                          {respondent.temperature === 'warm' && 'Morno'}
                          {respondent.temperature === 'hot' && 'Quente'}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>

                  {/* Expanded row */}
                  {isExpanded && (
                    <tr className="bg-emerald-50/50 border-b">
                      <td colSpan={7} className="px-4 py-4">
                        <div className="space-y-4">
                          {/* Basic info */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {respondent.document_id && (
                              <div>
                                <p className="text-xs text-gray-500 font-medium mb-1">Documento</p>
                                <p className="text-sm text-gray-900">{respondent.document_id}</p>
                              </div>
                            )}
                            {respondent.city && (
                              <div>
                                <p className="text-xs text-gray-500 font-medium mb-1">Cidade</p>
                                <p className="text-sm text-gray-900">
                                  {respondent.city}
                                  {respondent.state ? `, ${respondent.state}` : ''}
                                </p>
                              </div>
                            )}
                            {respondent.icp_score != null && (
                              <div>
                                <p className="text-xs text-gray-500 font-medium mb-1">ICP Score</p>
                                <p className="text-sm text-gray-900 font-bold">{Number(respondent.icp_score).toFixed(0)}/100</p>
                                {respondent.icp_score_details && (
                                  <div className="mt-1 space-y-0.5">
                                    <p className="text-xs text-gray-500">
                                      Avatar: {(respondent.icp_score_details as Record<string, unknown>).best_avatar_label as string || '—'}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                      Prob. conversão: {(((respondent.icp_score_details as Record<string, unknown>).conversion_probability as number) * 100).toFixed(0)}%
                                    </p>
                                    {((respondent.icp_score_details as Record<string, unknown>).avatar_scores as Array<{avatar_label: string; score: number; was_capped: boolean}>)?.map((as, i) => (
                                      <p key={i} className="text-xs text-gray-400">
                                        {as.avatar_label}: {as.score.toFixed(0)} {as.was_capped ? '(cap)' : ''}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {respondent.surveys_responded !== null && (
                              <div>
                                <p className="text-xs text-gray-500 font-medium mb-1">Pesquisas respondidas</p>
                                <p className="text-sm text-gray-900">{respondent.surveys_responded}</p>
                              </div>
                            )}
                          </div>

                          {/* Open answers */}
                          {isLoadingAnswers ? (
                            <div className="flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                              <p className="text-xs text-gray-500">Carregando respostas abertas...</p>
                            </div>
                          ) : answers && Object.keys(answers).length > 0 ? (
                            <div className="space-y-3">
                              <p className="text-xs text-gray-500 font-medium">Respostas abertas</p>
                              {Object.entries(answers).map(([question, answer]) => (
                                <div key={question} className="bg-white rounded p-2.5 border border-gray-100">
                                  <p className="text-xs text-gray-600 font-medium mb-1">{question}</p>
                                  <p className="text-xs text-gray-800 whitespace-pre-wrap">{answer}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400">Sem respostas abertas</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-4 py-3 border-t flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Mostrando {respondents.length > 0 ? (page - 1) * ITEMS_PER_PAGE + 1 : 0} a{' '}
          {Math.min(page * ITEMS_PER_PAGE, total)} de {total} respondentes
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1 || loading}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Anterior
          </button>
          <span className="text-xs text-gray-600">
            Página {page} de {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages || loading}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  )
}

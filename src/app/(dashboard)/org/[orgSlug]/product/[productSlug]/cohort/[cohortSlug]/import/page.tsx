'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Play,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ColumnClassification } from '@/lib/classify-columns'
import type { ColumnStats } from '@/lib/parsers/csv-xlsx'

type Step = 'upload' | 'preview' | 'classify' | 'review' | 'process' | 'done'

const SURVEY_TYPES = [
  { value: 'captacao', label: 'Captação de leads' },
  { value: 'pre_venda', label: 'Pré-venda' },
  { value: 'engajamento', label: 'Engajamento' },
  { value: 'pos_venda', label: 'Pós-venda / Onboarding' },
  { value: 'feedback', label: 'Feedback' },
]

const COLUMN_TYPE_LABELS: Record<string, string> = {
  identifier_email: 'Email',
  identifier_name: 'Nome',
  identifier_phone: 'Telefone',
  identifier_doc: 'Documento',
  identifier_social: 'Rede social',
  utm: 'UTM',
  metadata_timestamp: 'Timestamp',
  metadata_system: 'Sistema',
  noise: 'Ruído (ignorar)',
  closed_multiple_choice: 'Múltipla escolha',
  closed_scale: 'Escala',
  closed_range: 'Faixa',
  closed_binary: 'Sim/Não',
  closed_checkbox_group: 'Checkbox (grupo)',
  semi_closed: 'Semi-aberta',
  open: 'Aberta',
}

const COLUMN_TYPE_COLORS: Record<string, string> = {
  identifier_email: 'bg-blue-100 text-blue-700',
  identifier_name: 'bg-blue-100 text-blue-700',
  identifier_phone: 'bg-blue-100 text-blue-700',
  identifier_doc: 'bg-blue-100 text-blue-700',
  identifier_social: 'bg-blue-100 text-blue-700',
  utm: 'bg-purple-100 text-purple-700',
  metadata_timestamp: 'bg-gray-100 text-gray-600',
  metadata_system: 'bg-gray-100 text-gray-600',
  noise: 'bg-red-100 text-red-600',
  closed_multiple_choice: 'bg-emerald-100 text-emerald-700',
  closed_scale: 'bg-emerald-100 text-emerald-700',
  closed_range: 'bg-emerald-100 text-emerald-700',
  closed_binary: 'bg-emerald-100 text-emerald-700',
  closed_checkbox_group: 'bg-amber-100 text-amber-700',
  semi_closed: 'bg-yellow-100 text-yellow-700',
  open: 'bg-violet-100 text-violet-700',
}

const ALL_COLUMN_TYPES = Object.keys(COLUMN_TYPE_LABELS)

export default function ImportPage() {
  const params = useParams()
  const router = useRouter()
  const { orgSlug, productSlug, cohortSlug } = params as {
    orgSlug: string
    productSlug: string
    cohortSlug: string
  }

  const [step, setStep] = useState<Step>('upload')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Upload state
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [surveyName, setSurveyName] = useState('')
  const [surveyType, setSurveyType] = useState('captacao')
  const [hasMergeableData, setHasMergeableData] = useState(false)

  // Preview state
  const [surveyId, setSurveyId] = useState<string | null>(null)
  const [cohortId, setCohortId] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<string[][]>([])
  const [totalRows, setTotalRows] = useState(0)
  const [stats, setStats] = useState<ColumnStats[]>([])
  const [checkboxGroups, setCheckboxGroups] = useState<{ groupName: string; columnIndices: number[] }[]>([])

  // Classification state
  const [columns, setColumns] = useState<ColumnClassification[]>([])
  const [expandedCol, setExpandedCol] = useState<number | null>(null)

  // Process state
  const [processedCount, setProcessedCount] = useState(0)

  const supabase = createClient()

  // Resolve cohort_id from slugs and check for existing surveys
  async function resolveCohortId(): Promise<string | null> {
    if (cohortId) return cohortId

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase.from('users').select('org_id').eq('id', user.id).single()
    if (!profile) return null

    const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).eq('id', profile.org_id).single()
    if (!org) return null

    const { data: product } = await supabase.from('products').select('id').eq('org_id', org.id).eq('slug', productSlug).single()
    if (!product) return null

    const { data: cohort } = await supabase.from('cohorts').select('id').eq('product_id', product.id).eq('slug', cohortSlug).single()
    if (!cohort) return null

    setCohortId(cohort.id)

    // Check if there are existing surveys for this cohort
    const { data: surveys } = await supabase
      .from('surveys')
      .select('id', { count: 'exact' })
      .eq('cohort_id', cohort.id)
      .limit(1)

    if (surveys && surveys.length > 0) {
      setHasMergeableData(true)
    }

    return cohort.id
  }

  // Step 1: Upload file
  async function handleUpload() {
    if (!file) return
    setLoading(true)
    setError(null)

    const resolvedCohortId = await resolveCohortId()
    if (!resolvedCohortId) {
      setError('Turma não encontrada.')
      setLoading(false)
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('cohort_id', resolvedCohortId)
    formData.append('name', surveyName || file.name)
    formData.append('survey_type', surveyType)

    try {
      const res = await fetch('/api/surveys/upload', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error)
        setLoading(false)
        return
      }

      setSurveyId(data.survey.id)
      setHeaders(data.preview.headers)
      setPreviewRows(data.preview.previewRows)
      setTotalRows(data.preview.totalRows)
      setStats(data.preview.stats)
      setCheckboxGroups(data.preview.checkboxGroups)
      setStep('preview')
    } catch {
      setError('Erro ao fazer upload')
    }
    setLoading(false)
  }

  // Step 2: Classify columns
  async function handleClassify() {
    if (!surveyId) return
    setLoading(true)
    setError(null)
    setStep('classify')

    try {
      const res = await fetch('/api/surveys/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surveyId,
          headers,
          stats,
          sampleRows: previewRows,
          checkboxGroups,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error)
        setStep('preview')
        setLoading(false)
        return
      }

      setColumns(data.classification.columns)
      setStep('review')
    } catch {
      setError('Erro na classificação')
      setStep('preview')
    }
    setLoading(false)
  }

  // Step 3: Process data
  async function handleProcess() {
    if (!surveyId || columns.length === 0) return
    setLoading(true)
    setError(null)
    setStep('process')

    try {
      const res = await fetch('/api/surveys/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surveyId, columns }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error)
        setStep('review')
        setLoading(false)
        return
      }

      setProcessedCount(data.processedCount)
      setStep('done')
    } catch {
      setError('Erro no processamento')
      setStep('review')
    }
    setLoading(false)
  }

  // Update a column classification
  function updateColumn(index: number, field: string, value: string) {
    setColumns((prev) =>
      prev.map((col) =>
        col.index === index ? { ...col, [field]: value } : col
      )
    )
  }

  // Drag and drop - only takes first file
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      setFile(droppedFile)
      if (!surveyName) setSurveyName(droppedFile.name.replace(/\.(csv|xlsx|xls)$/i, ''))
    }
  }, [surveyName])

  // Initialize cohort check on mount
  useEffect(() => {
    resolveCohortId()
  }, [cohortId])

  const basePath = `/org/${orgSlug}/product/${productSlug}/cohort/${cohortSlug}`

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push(basePath)}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Importar pesquisa</h1>
          <p className="text-sm text-gray-500">Upload, classificação e processamento</p>
        </div>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-1 mb-8">
        {(['upload', 'preview', 'classify', 'review', 'process', 'done'] as Step[]).map((s, i) => {
          const labels = ['Upload', 'Preview', 'Classificando', 'Revisão', 'Processando', 'Concluído']
          const isActive = step === s
          const isPast = ['upload', 'preview', 'classify', 'review', 'process', 'done'].indexOf(step) > i
          return (
            <div key={s} className="flex items-center gap-1">
              <div
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full font-medium',
                  isActive && 'bg-emerald-600 text-white',
                  isPast && 'bg-emerald-100 text-emerald-700',
                  !isActive && !isPast && 'bg-gray-100 text-gray-400'
                )}
              >
                {labels[i]}
              </div>
              {i < 5 && <div className="w-4 h-px bg-gray-300" />}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-6 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* STEP: Upload */}
      {step === 'upload' && (
        <div className="space-y-6">
          {hasMergeableData && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <span className="font-medium">Aviso de mesclagem:</span> Esta turma já possui dados de pesquisas anteriores. Novos uploads serão automaticamente mesclados com os dados existentes por email. Respondentes duplicados terão suas respostas atualizadas com novas informações.
              </p>
            </div>
          )}

          <div className="bg-white rounded-xl border p-6">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              'border-2 border-dashed rounded-xl p-12 text-center transition-colors',
              dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
            )}
          >
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
                <div className="text-left">
                  <p className="font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
                <button
                  onClick={() => setFile(null)}
                  className="ml-4 text-xs text-gray-500 hover:text-red-600"
                >
                  Remover
                </button>
              </div>
            ) : (
              <>
                <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-600 mb-1">Arraste um arquivo CSV ou XLSX aqui</p>
                <p className="text-xs text-gray-400 mb-4">ou clique para selecionar</p>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  multiple
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) {
                      setFile(f)
                      if (!surveyName) setSurveyName(f.name.replace(/\.(csv|xlsx|xls)$/i, ''))
                    }
                  }}
                  className="hidden"
                  id="file-input"
                />
                <label
                  htmlFor="file-input"
                  className="inline-flex items-center px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Selecionar arquivo
                </label>
              </>
            )}
          </div>

          {file && (
            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome da pesquisa
                </label>
                <input
                  type="text"
                  value={surveyName}
                  onChange={(e) => setSurveyName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo da pesquisa
                </label>
                <select
                  value={surveyType}
                  onChange={(e) => setSurveyType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                >
                  {SURVEY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleUpload}
                disabled={loading}
                className="w-full py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {loading ? 'Enviando...' : 'Enviar e analisar'}
              </button>
            </div>
          )}
          </div>
        </div>
      )}

      {/* STEP: Preview */}
      {step === 'preview' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Preview dos dados</h2>
              <span className="text-sm text-gray-500">{totalRows} linhas · {headers.length} colunas</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    {headers.map((h, i) => (
                      <th key={i} className="text-left p-2 font-medium text-gray-700 whitespace-nowrap max-w-[200px] truncate" title={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={ri} className="border-b border-gray-50">
                      {row.map((cell, ci) => (
                        <td key={ci} className="p-2 text-gray-600 whitespace-nowrap max-w-[200px] truncate" title={cell}>
                          {cell || <span className="text-gray-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {checkboxGroups.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-medium text-amber-800 mb-2">
                Grupos de checkbox detectados ({checkboxGroups.length})
              </p>
              {checkboxGroups.map((g, i) => (
                <p key={i} className="text-xs text-amber-700">
                  "{g.groupName}" — {g.columnIndices.length} opções
                </p>
              ))}
            </div>
          )}

          <button
            onClick={handleClassify}
            disabled={loading}
            className="w-full py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Classificar colunas com IA
          </button>
        </div>
      )}

      {/* STEP: Classifying */}
      {step === 'classify' && (
        <div className="bg-white rounded-xl border p-12 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-emerald-600 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Classificando colunas...</h2>
          <p className="text-sm text-gray-500">
            O Claude está analisando {headers.length} colunas. Isso pode levar 10-30 segundos.
          </p>
        </div>
      )}

      {/* STEP: Review */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Revisão da classificação</h2>
              <p className="text-xs text-gray-500">Ajuste qualquer classificação antes de processar</p>
            </div>

            <div className="space-y-1">
              {columns.map((col) => {
                const isExpanded = expandedCol === col.index
                const isNoise = col.columnType === 'noise' || col.columnType === 'metadata_system'

                return (
                  <div
                    key={col.index}
                    className={cn(
                      'border rounded-lg transition-colors',
                      isNoise ? 'opacity-50' : '',
                      isExpanded ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-100'
                    )}
                  >
                    <button
                      onClick={() => setExpandedCol(isExpanded ? null : col.index)}
                      className="flex items-center w-full px-3 py-2.5 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 mr-2 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 mr-2 text-gray-400" />
                      )}
                      <span className="text-sm text-gray-900 truncate flex-1 mr-3" title={col.header}>
                        {col.normalizedHeader || col.header}
                      </span>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium mr-2', COLUMN_TYPE_COLORS[col.columnType] || 'bg-gray-100 text-gray-600')}>
                        {COLUMN_TYPE_LABELS[col.columnType] || col.columnType}
                      </span>
                      {col.semanticCategory && (
                        <span className="text-xs text-gray-500">
                          {col.semanticCategory}
                        </span>
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-gray-100 space-y-3">
                        <p className="text-xs text-gray-500">{col.reasoning}</p>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                            <select
                              value={col.columnType}
                              onChange={(e) => updateColumn(col.index, 'columnType', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            >
                              {ALL_COLUMN_TYPES.map((t) => (
                                <option key={t} value={t}>{COLUMN_TYPE_LABELS[t]}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Categoria semântica</label>
                            <select
                              value={col.semanticCategory || ''}
                              onChange={(e) => updateColumn(col.index, 'semanticCategory', e.target.value || '')}
                              className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            >
                              <option value="">Nenhuma</option>
                              <option value="qualification">Qualificação</option>
                              <option value="professional_profile">Perfil profissional</option>
                              <option value="revenue_current">Faturamento atual</option>
                              <option value="revenue_desired">Faturamento desejado</option>
                              <option value="pain_challenge">Dor / Desafio</option>
                              <option value="desire_goal">Desejo / Objetivo</option>
                              <option value="purchase_intent">Intenção de compra</option>
                              <option value="purchase_decision">Decisão de compra</option>
                              <option value="purchase_objection">Objeção</option>
                              <option value="experience_time">Tempo de experiência</option>
                              <option value="how_discovered">Como conheceu</option>
                              <option value="feedback">Feedback</option>
                              <option value="hypothetical">Hipotética</option>
                              <option value="content_request">Conteúdo desejado</option>
                              <option value="personal_data">Dados pessoais</option>
                              <option value="investment_willingness">Disposição investimento</option>
                              <option value="engagement_checklist">Checklist engajamento</option>
                            </select>
                          </div>
                        </div>

                        <div className="text-xs text-gray-400">
                          Amostras: {stats[col.index]?.sampleValues?.join(' · ') || '—'}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <button
            onClick={handleProcess}
            disabled={loading}
            className="w-full py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4" />
            Processar dados
          </button>
        </div>
      )}

      {/* STEP: Processing */}
      {step === 'process' && (
        <div className="bg-white rounded-xl border p-12 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-emerald-600 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Processando...</h2>
          <p className="text-sm text-gray-500">
            Normalizando identificadores, criando respondentes e distribuindo dados.
          </p>
        </div>
      )}

      {/* STEP: Done */}
      {step === 'done' && (
        <div className="bg-white rounded-xl border p-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Pesquisa processada!</h2>
          <p className="text-sm text-gray-500 mb-6">
            {processedCount} de {totalRows} linhas processadas com sucesso.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => router.push(basePath)}
              className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
            >
              Voltar para a turma
            </button>
            <button
              onClick={() => {
                setStep('upload')
                setFile(null)
                setSurveyId(null)
                setColumns([])
                setError(null)
              }}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Importar outra
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

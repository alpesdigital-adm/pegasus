'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Play,
  X,
  Trash2,
  CheckSquare,
  Square,
  Minus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ColumnClassification } from '@/lib/classify-columns'
import type { ColumnStats } from '@/lib/parsers/csv-xlsx'

// ─── Types ───────────────────────────────────────────────────

type Step = 'upload' | 'reviewing' | 'processing' | 'done'

type FileStep = 'pending' | 'uploading' | 'preview' | 'classifying' | 'review' | 'reviewed' | 'processing' | 'done' | 'error' | 'duplicate'

interface FileEntry {
  id: string
  file: File
  name: string
  surveyType: string
  step: FileStep
  error?: string
  duplicateMessage?: string
  // Upload result
  surveyId?: string
  headers?: string[]
  previewRows?: string[][]
  totalRows?: number
  stats?: ColumnStats[]
  checkboxGroups?: { groupName: string; columnIndices: number[] }[]
  // Classification result
  columns?: ColumnClassification[]
  // Process result
  processedCount?: number
}

// ─── Constants ───────────────────────────────────────────────

const SURVEY_TYPES = [
  { value: 'captacao', label: 'Captação de leads' },
  { value: 'pre_venda', label: 'Pré-venda' },
  { value: 'engajamento', label: 'Engajamento' },
  { value: 'pos_venda', label: 'Pós-venda / Onboarding' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'vendas', label: 'Lista de vendas' },
]

const COLUMN_TYPE_LABELS: Record<string, string> = {
  identifier_email: 'Email', identifier_name: 'Nome', identifier_phone: 'Telefone',
  identifier_doc: 'Documento', identifier_social: 'Rede social',
  utm: 'UTM', metadata_timestamp: 'Timestamp', metadata_system: 'Sistema',
  noise: 'Ruído (ignorar)', closed_multiple_choice: 'Múltipla escolha',
  closed_scale: 'Escala', closed_range: 'Faixa', closed_binary: 'Sim/Não',
  closed_checkbox_group: 'Checkbox (grupo)', semi_closed: 'Semi-aberta', open: 'Aberta',
  sale_product_name: 'Produto (venda)', sale_amount: 'Valor pago',
  sale_payment_method: 'Forma pgto', sale_installments: 'Parcelas', sale_date: 'Data compra',
}

const COLUMN_TYPE_COLORS: Record<string, string> = {
  identifier_email: 'bg-blue-100 text-blue-700', identifier_name: 'bg-blue-100 text-blue-700',
  identifier_phone: 'bg-blue-100 text-blue-700', identifier_doc: 'bg-blue-100 text-blue-700',
  identifier_social: 'bg-blue-100 text-blue-700',
  utm: 'bg-purple-100 text-purple-700', metadata_timestamp: 'bg-gray-100 text-gray-600',
  metadata_system: 'bg-gray-100 text-gray-600', noise: 'bg-red-100 text-red-600',
  closed_multiple_choice: 'bg-emerald-100 text-emerald-700', closed_scale: 'bg-emerald-100 text-emerald-700',
  closed_range: 'bg-emerald-100 text-emerald-700', closed_binary: 'bg-emerald-100 text-emerald-700',
  closed_checkbox_group: 'bg-amber-100 text-amber-700',
  semi_closed: 'bg-yellow-100 text-yellow-700', open: 'bg-violet-100 text-violet-700',
  sale_product_name: 'bg-pink-100 text-pink-700', sale_amount: 'bg-pink-100 text-pink-700',
  sale_payment_method: 'bg-pink-100 text-pink-700', sale_installments: 'bg-pink-100 text-pink-700',
  sale_date: 'bg-pink-100 text-pink-700',
}

const ALL_COLUMN_TYPES = Object.keys(COLUMN_TYPE_LABELS)

const SEMANTIC_CATEGORIES = [
  { value: '', label: 'Nenhuma' },
  { value: 'qualification', label: 'Qualificação' },
  { value: 'professional_profile', label: 'Perfil profissional' },
  { value: 'revenue_current', label: 'Faturamento atual' },
  { value: 'revenue_desired', label: 'Faturamento desejado' },
  { value: 'pain_challenge', label: 'Dor / Desafio' },
  { value: 'desire_goal', label: 'Desejo / Objetivo' },
  { value: 'purchase_intent', label: 'Intenção de compra' },
  { value: 'purchase_decision', label: 'Decisão de compra' },
  { value: 'purchase_objection', label: 'Objeção' },
  { value: 'experience_time', label: 'Tempo de experiência' },
  { value: 'how_discovered', label: 'Como conheceu' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'hypothetical', label: 'Hipotética' },
  { value: 'content_request', label: 'Conteúdo desejado' },
  { value: 'personal_data', label: 'Dados pessoais' },
  { value: 'investment_willingness', label: 'Disposição investimento' },
  { value: 'engagement_checklist', label: 'Checklist engajamento' },
]

// ─── Component ───────────────────────────────────────────────

export default function ImportPage() {
  const params = useParams()
  const router = useRouter()
  const { orgSlug, productSlug, cohortSlug } = params as {
    orgSlug: string; productSlug: string; cohortSlug: string
  }

  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [hasMergeableData, setHasMergeableData] = useState(false)
  const [cohortId, setCohortId] = useState<string | null>(null)

  // File queue
  const [files, setFiles] = useState<FileEntry[]>([])
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [expandedCol, setExpandedCol] = useState<number | null>(null)

  // Processing state
  const [processingIndex, setProcessingIndex] = useState(0)
  const [totalProcessed, setTotalProcessed] = useState(0)

  // Bulk selection
  const [selectedCols, setSelectedCols] = useState<Set<number>>(new Set())
  const [bulkType, setBulkType] = useState('')
  const [bulkCategory, setBulkCategory] = useState('')

  // Classification overrides (learned corrections)
  const [overrides, setOverrides] = useState<Record<string, { columnType: string; semanticCategory: string | null }>>({})
  const overridesLoaded = useRef(false)

  const fileIdCounter = useRef(0)
  const supabase = createClient()

  const activeFile = files[activeFileIndex] || null
  const reviewableFiles = files.filter((f) => f.step !== 'duplicate' && f.step !== 'error')
  const allReviewed = reviewableFiles.length > 0 && reviewableFiles.every((f) => f.step === 'reviewed' || f.step === 'done')

  // ─── Resolve cohort ──────────────────────────────────────

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
    const { data: surveys } = await supabase.from('surveys').select('id', { count: 'exact' }).eq('cohort_id', cohort.id).limit(1)
    if (surveys && surveys.length > 0) setHasMergeableData(true)
    return cohort.id
  }

  useEffect(() => { resolveCohortId() }, [cohortId])

  // ─── File management ─────────────────────────────────────

  function addFiles(newFiles: FileList | File[]) {
    const entries: FileEntry[] = Array.from(newFiles)
      .filter((f) => {
        const name = f.name.toLowerCase()
        return name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls')
      })
      .map((f) => ({
        id: `file-${++fileIdCounter.current}`,
        file: f,
        name: f.name.replace(/\.(csv|xlsx|xls)$/i, ''),
        surveyType: 'captacao',
        step: 'pending' as FileStep,
      }))

    if (entries.length === 0) return
    setFiles((prev) => [...prev, ...entries])
  }

  function removeFile(id: string) {
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== id)
      if (activeFileIndex >= next.length && next.length > 0) {
        setActiveFileIndex(next.length - 1)
      }
      return next
    })
  }

  function updateFile(id: string, updates: Partial<FileEntry>) {
    setFiles((prev) => prev.map((f) => f.id === id ? { ...f, ...updates } : f))
  }

  function updateFileColumn(fileId: string, colIndex: number, field: string, value: string) {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== fileId || !f.columns) return f
        return {
          ...f,
          columns: f.columns.map((col) =>
            col.index === colIndex ? { ...col, [field]: value } : col
          ),
        }
      })
    )
  }

  // ─── Bulk selection ──────────────────────────────────────

  function toggleColSelection(colIndex: number) {
    setSelectedCols((prev) => {
      const next = new Set(prev)
      if (next.has(colIndex)) next.delete(colIndex)
      else next.add(colIndex)
      return next
    })
  }

  function toggleAllCols() {
    if (!activeFile?.columns) return
    if (selectedCols.size === activeFile.columns.length) {
      setSelectedCols(new Set())
    } else {
      setSelectedCols(new Set(activeFile.columns.map((c) => c.index)))
    }
  }

  function applyBulkEdit() {
    if (!activeFile || selectedCols.size === 0) return
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== activeFile.id || !f.columns) return f
        return {
          ...f,
          columns: f.columns.map((col) => {
            if (!selectedCols.has(col.index)) return col
            const updated = { ...col }
            if (bulkType) updated.columnType = bulkType
            if (bulkCategory !== '') updated.semanticCategory = bulkCategory || null
            return updated
          }),
        }
      })
    )
    setSelectedCols(new Set())
    setBulkType('')
    setBulkCategory('')
  }

  // ─── Classification overrides (learning) ─────────────────

  async function loadOverrides() {
    const cId = await resolveCohortId()
    if (!cId || overridesLoaded.current) return
    try {
      const res = await fetch(`/api/surveys/overrides?cohortId=${cId}`)
      if (res.ok) {
        const data = await res.json()
        setOverrides(data.overrides || {})
      }
    } catch { /* silent */ }
    overridesLoaded.current = true
  }

  async function saveOverrides(columns: ColumnClassification[]) {
    const cId = cohortId
    if (!cId || columns.length === 0) return
    const entries = columns.map((col) => ({
      normalizedHeader: col.normalizedHeader,
      columnType: col.columnType,
      semanticCategory: col.semanticCategory,
    }))
    try {
      await fetch('/api/surveys/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cohortId: cId, overrides: entries }),
      })
      // Update local overrides cache
      const updated = { ...overrides }
      for (const e of entries) {
        updated[e.normalizedHeader] = { columnType: e.columnType, semanticCategory: e.semanticCategory }
      }
      setOverrides(updated)
    } catch { /* silent */ }
  }

  function applyOverridesToClassification(columns: ColumnClassification[]): ColumnClassification[] {
    if (Object.keys(overrides).length === 0) return columns
    let appliedCount = 0
    const result = columns.map((col) => {
      const override = overrides[col.normalizedHeader]
      if (override) {
        appliedCount++
        return {
          ...col,
          columnType: override.columnType,
          semanticCategory: override.semanticCategory,
          reasoning: `(Classificação aprendida de correção anterior) ${col.reasoning}`,
          confidence: 1.0,
        }
      }
      return col
    })
    return result
  }

  // Clear selection when changing files
  useEffect(() => {
    setSelectedCols(new Set())
    setExpandedCol(null)
  }, [activeFileIndex])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }, [])

  // ─── Upload + Classify a single file ─────────────────────

  async function uploadAndClassifyFile(entry: FileEntry): Promise<void> {
    const resolvedCohortId = await resolveCohortId()
    if (!resolvedCohortId) {
      updateFile(entry.id, { step: 'error', error: 'Turma não encontrada.' })
      return
    }

    // Upload
    updateFile(entry.id, { step: 'uploading' })
    const formData = new FormData()
    formData.append('file', entry.file)
    formData.append('cohort_id', resolvedCohortId)
    formData.append('name', entry.name || entry.file.name)
    formData.append('survey_type', entry.surveyType)

    try {
      const res = await fetch('/api/surveys/upload', { method: 'POST', body: formData })
      const data = await res.json()

      if (res.status === 409 && data.duplicate) {
        updateFile(entry.id, { step: 'duplicate', duplicateMessage: data.message })
        return
      }

      if (!res.ok) {
        updateFile(entry.id, { step: 'error', error: data.error })
        return
      }

      updateFile(entry.id, {
        step: 'classifying',
        surveyId: data.survey.id,
        headers: data.preview.headers,
        previewRows: data.preview.previewRows,
        totalRows: data.preview.totalRows,
        stats: data.preview.stats,
        checkboxGroups: data.preview.checkboxGroups,
      })

      // Auto-classify
      const classRes = await fetch('/api/surveys/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surveyId: data.survey.id,
          headers: data.preview.headers,
          stats: data.preview.stats,
          sampleRows: data.preview.previewRows,
          checkboxGroups: data.preview.checkboxGroups,
        }),
      })
      const classData = await classRes.json()

      if (!classRes.ok) {
        updateFile(entry.id, { step: 'error', error: classData.error })
        return
      }

      // Apply learned overrides to classification
      const classifiedColumns = applyOverridesToClassification(classData.classification.columns)

      updateFile(entry.id, {
        step: 'review',
        columns: classifiedColumns,
      })
    } catch {
      updateFile(entry.id, { step: 'error', error: 'Erro ao fazer upload' })
    }
  }

  // ─── Start reviewing: upload + classify all sequentially ──

  async function startReviewing() {
    setStep('reviewing')
    setError(null)

    // Load learned overrides before classifying
    await loadOverrides()

    const pendingFiles = files.filter((f) => f.step === 'pending')
    for (let i = 0; i < pendingFiles.length; i++) {
      const entry = pendingFiles[i]
      // Set active to this file's index in the full array
      const fullIndex = files.findIndex((f) => f.id === entry.id)
      setActiveFileIndex(fullIndex)
      await uploadAndClassifyFile(entry)
    }

    // Focus on first file that needs review
    const firstReview = files.findIndex((f) => f.step === 'review')
    if (firstReview >= 0) setActiveFileIndex(firstReview)
  }

  // ─── Confirm review for current file ─────────────────────

  async function confirmCurrentReview() {
    if (!activeFile) return
    updateFile(activeFile.id, { step: 'reviewed' })

    // Save classification as overrides for future files
    if (activeFile.columns) {
      await saveOverrides(activeFile.columns)
      // Apply newly learned overrides to any files still in review
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id === activeFile.id || !f.columns || f.step !== 'review') return f
          return { ...f, columns: applyOverridesToClassification(f.columns) }
        })
      )
    }

    // Move to next file that needs review
    const nextIndex = files.findIndex((f, i) => i > activeFileIndex && f.step === 'review')
    if (nextIndex >= 0) {
      setActiveFileIndex(nextIndex)
      setExpandedCol(null)
    }
  }

  // ─── Process all reviewed files sequentially ──────────────

  async function processAllFiles() {
    setStep('processing')
    setError(null)
    setProcessingIndex(0)
    setTotalProcessed(0)

    const toProcess = files.filter((f) => f.step === 'reviewed')

    for (let i = 0; i < toProcess.length; i++) {
      const entry = toProcess[i]
      setProcessingIndex(i)
      updateFile(entry.id, { step: 'processing' })

      try {
        const res = await fetch('/api/surveys/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ surveyId: entry.surveyId, columns: entry.columns }),
        })
        const data = await res.json()

        if (!res.ok) {
          updateFile(entry.id, { step: 'error', error: data.error })
          continue
        }

        updateFile(entry.id, { step: 'done', processedCount: data.processedCount })
        setTotalProcessed((prev) => prev + (data.processedCount || 0))
      } catch {
        updateFile(entry.id, { step: 'error', error: 'Erro no processamento' })
      }
    }

    setStep('done')
  }

  // ─── Derived state ───────────────────────────────────────

  const basePath = `/org/${orgSlug}/product/${productSlug}/cohort/${cohortSlug}`
  const pendingCount = files.filter((f) => f.step === 'pending').length
  const reviewCount = files.filter((f) => f.step === 'review').length
  const reviewedCount = files.filter((f) => f.step === 'reviewed').length
  const processingFile = files.find((f) => f.step === 'processing')
  const doneCount = files.filter((f) => f.step === 'done').length
  const errorCount = files.filter((f) => f.step === 'error').length
  const duplicateCount = files.filter((f) => f.step === 'duplicate').length
  const isUploading = files.some((f) => f.step === 'uploading' || f.step === 'classifying')

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push(basePath)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Importar pesquisas</h1>
          <p className="text-sm text-gray-500">
            {step === 'upload' && 'Selecione um ou mais arquivos CSV/XLSX'}
            {step === 'reviewing' && `Revisando classificações · ${reviewCount} pendente(s)`}
            {step === 'processing' && `Processando ${processingIndex + 1} de ${reviewedCount + doneCount}`}
            {step === 'done' && `${doneCount} pesquisa(s) processada(s)`}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-6 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ════════════ STEP: Upload ════════════ */}
      {step === 'upload' && (
        <div className="space-y-6">
          {hasMergeableData && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <span className="font-medium">Aviso de mesclagem:</span> Esta turma já possui dados. Novos uploads serão mesclados automaticamente por email.
              </p>
            </div>
          )}

          {/* Drop zone */}
          <div className="bg-white rounded-xl border p-6">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                'border-2 border-dashed rounded-xl p-10 text-center transition-colors',
                dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 mb-1">Arraste arquivos CSV ou XLSX aqui</p>
              <p className="text-xs text-gray-400 mb-4">Você pode selecionar vários arquivos de uma vez</p>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                multiple
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files)
                  e.target.value = ''
                }}
                className="hidden"
                id="file-input"
              />
              <label
                htmlFor="file-input"
                className="inline-flex items-center px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Selecionar arquivos
              </label>
            </div>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="bg-white rounded-xl border divide-y">
              {files.map((entry, idx) => (
                <div key={entry.id} className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <input
                        type="text"
                        value={entry.name}
                        onChange={(e) => updateFile(entry.id, { name: e.target.value })}
                        className="w-full text-sm font-medium text-gray-900 bg-transparent border-0 border-b border-transparent hover:border-gray-300 focus:border-emerald-500 focus:outline-none px-0 py-0.5"
                        placeholder="Nome da pesquisa"
                      />
                      <p className="text-xs text-gray-400">{entry.file.name} · {(entry.file.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <select
                      value={entry.surveyType}
                      onChange={(e) => updateFile(entry.id, { surveyType: e.target.value })}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      {SURVEY_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeFile(entry.id)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Action button */}
              <div className="px-5 py-4">
                <button
                  onClick={startReviewing}
                  disabled={files.length === 0}
                  className="w-full py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Enviar {files.length} arquivo{files.length !== 1 ? 's' : ''} e classificar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════ STEP: Reviewing ════════════ */}
      {step === 'reviewing' && (
        <div className="space-y-4">
          {/* File tabs */}
          <div className="flex gap-1 overflow-x-auto pb-1">
            {files.map((entry, idx) => {
              const isActive = idx === activeFileIndex
              const stepColors: Record<FileStep, string> = {
                pending: 'bg-gray-100 text-gray-500',
                uploading: 'bg-blue-100 text-blue-700',
                preview: 'bg-blue-100 text-blue-700',
                classifying: 'bg-blue-100 text-blue-700',
                review: 'bg-amber-100 text-amber-700',
                reviewed: 'bg-emerald-100 text-emerald-700',
                processing: 'bg-blue-100 text-blue-700',
                done: 'bg-emerald-100 text-emerald-700',
                error: 'bg-red-100 text-red-700',
                duplicate: 'bg-amber-100 text-amber-600',
              }
              const stepLabels: Record<FileStep, string> = {
                pending: 'Aguardando', uploading: 'Enviando', preview: 'Preview',
                classifying: 'Classificando', review: 'Revisar', reviewed: '✓ Revisado',
                processing: 'Processando', done: '✓ Concluído', error: '✗ Erro',
                duplicate: 'Duplicado',
              }

              return (
                <button
                  key={entry.id}
                  onClick={() => { setActiveFileIndex(idx); setExpandedCol(null) }}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                    isActive ? 'bg-white border border-gray-300 shadow-sm' : 'hover:bg-gray-100'
                  )}
                >
                  <span className={cn('px-1.5 py-0.5 rounded text-[10px]', stepColors[entry.step])}>
                    {stepLabels[entry.step]}
                  </span>
                  <span className="truncate max-w-[120px]">{entry.name}</span>
                </button>
              )
            })}
          </div>

          {/* Active file content */}
          {activeFile && (
            <>
              {/* Uploading / Classifying */}
              {(activeFile.step === 'uploading' || activeFile.step === 'classifying' || activeFile.step === 'pending') && (
                <div className="bg-white rounded-xl border p-12 text-center">
                  <Loader2 className="w-10 h-10 animate-spin text-emerald-600 mx-auto mb-4" />
                  <h2 className="text-lg font-semibold text-gray-900 mb-2">
                    {activeFile.step === 'classifying' ? 'Classificando colunas...' : 'Enviando arquivo...'}
                  </h2>
                  <p className="text-sm text-gray-500">{activeFile.file.name}</p>
                </div>
              )}

              {/* Duplicate */}
              {activeFile.step === 'duplicate' && (
                <div className="bg-white rounded-xl border p-8">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Arquivo duplicado</h3>
                      <p className="text-sm text-gray-600">{activeFile.duplicateMessage}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {activeFile.step === 'error' && (
                <div className="bg-white rounded-xl border p-8">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Erro</h3>
                      <p className="text-sm text-red-600">{activeFile.error}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Review */}
              {(activeFile.step === 'review' || activeFile.step === 'reviewed') && activeFile.columns && (
                <div className="space-y-4">
                  {/* Preview summary */}
                  <div className="bg-white rounded-xl border p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold text-gray-900">{activeFile.name}</h2>
                        <p className="text-xs text-gray-500">
                          {activeFile.totalRows} linhas · {activeFile.headers?.length} colunas · {activeFile.file.name}
                        </p>
                      </div>
                      {activeFile.step === 'reviewed' && (
                        <span className="text-xs px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full font-medium">
                          Revisado ✓
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Data preview (collapsed) */}
                  {activeFile.previewRows && activeFile.headers && (
                    <details className="bg-white rounded-xl border">
                      <summary className="px-5 py-3 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
                        Preview dos dados
                      </summary>
                      <div className="px-5 pb-4 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b">
                              {activeFile.headers.map((h, i) => (
                                <th key={i} className="text-left p-2 font-medium text-gray-700 whitespace-nowrap max-w-[200px] truncate" title={h}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {activeFile.previewRows.slice(0, 3).map((row, ri) => (
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
                    </details>
                  )}

                  {/* Column classification review */}
                  <div className="bg-white rounded-xl border p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={toggleAllCols}
                          className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
                          title={selectedCols.size === activeFile.columns.length ? 'Desmarcar todos' : 'Selecionar todos'}
                        >
                          {selectedCols.size === 0 && <Square className="w-4 h-4" />}
                          {selectedCols.size > 0 && selectedCols.size < activeFile.columns.length && <Minus className="w-4 h-4" />}
                          {selectedCols.size === activeFile.columns.length && <CheckSquare className="w-4 h-4 text-emerald-600" />}
                        </button>
                        <h3 className="font-semibold text-gray-900">Classificação das colunas</h3>
                      </div>
                      <p className="text-xs text-gray-500">
                        {selectedCols.size > 0
                          ? `${selectedCols.size} selecionada${selectedCols.size !== 1 ? 's' : ''}`
                          : 'Ajuste se necessário'}
                      </p>
                    </div>

                    {/* Bulk edit bar */}
                    {selectedCols.size > 0 && (
                      <div className="flex items-center gap-2 mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                        <span className="text-xs font-medium text-emerald-800 shrink-0">Editar {selectedCols.size} campo{selectedCols.size !== 1 ? 's' : ''}:</span>
                        <select
                          value={bulkType}
                          onChange={(e) => setBulkType(e.target.value)}
                          className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        >
                          <option value="">Tipo (manter)</option>
                          {ALL_COLUMN_TYPES.map((t) => (
                            <option key={t} value={t}>{COLUMN_TYPE_LABELS[t]}</option>
                          ))}
                        </select>
                        <select
                          value={bulkCategory}
                          onChange={(e) => setBulkCategory(e.target.value)}
                          className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        >
                          <option value="">Categoria (manter)</option>
                          {SEMANTIC_CATEGORIES.map((sc) => (
                            <option key={sc.value} value={sc.value}>{sc.label}</option>
                          ))}
                        </select>
                        <button
                          onClick={applyBulkEdit}
                          disabled={!bulkType && bulkCategory === ''}
                          className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded hover:bg-emerald-700 disabled:opacity-50 transition-colors shrink-0"
                        >
                          Aplicar
                        </button>
                        <button
                          onClick={() => { setSelectedCols(new Set()); setBulkType(''); setBulkCategory('') }}
                          className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <div className="space-y-1">
                      {activeFile.columns.map((col) => {
                        const isExpanded = expandedCol === col.index
                        const isSelected = selectedCols.has(col.index)
                        const isNoise = col.columnType === 'noise' || col.columnType === 'metadata_system'
                        const isLearned = col.reasoning?.startsWith('(Classificação aprendida')

                        return (
                          <div
                            key={col.index}
                            className={cn(
                              'border rounded-lg transition-colors',
                              isNoise ? 'opacity-50' : '',
                              isSelected ? 'border-emerald-300 bg-emerald-50/20' : '',
                              isExpanded ? 'border-emerald-300 bg-emerald-50/30' : !isSelected ? 'border-gray-100' : ''
                            )}
                          >
                            <div className="flex items-center w-full px-3 py-2.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleColSelection(col.index) }}
                                className="p-0.5 mr-1.5 text-gray-400 hover:text-emerald-600 transition-colors shrink-0"
                              >
                                {isSelected
                                  ? <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                                  : <Square className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => setExpandedCol(isExpanded ? null : col.index)}
                                className="flex items-center flex-1 min-w-0 text-left"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5 mr-2 text-gray-400 shrink-0" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5 mr-2 text-gray-400 shrink-0" />
                                )}
                                <span className="text-sm text-gray-900 truncate flex-1 mr-3" title={col.header}>
                                  {col.normalizedHeader || col.header}
                                </span>
                                {isLearned && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium mr-2 shrink-0">
                                    aprendido
                                  </span>
                                )}
                                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium mr-2 shrink-0', COLUMN_TYPE_COLORS[col.columnType] || 'bg-gray-100 text-gray-600')}>
                                  {COLUMN_TYPE_LABELS[col.columnType] || col.columnType}
                                </span>
                                {col.semanticCategory && (
                                  <span className="text-xs text-gray-500 shrink-0">{col.semanticCategory}</span>
                                )}
                              </button>
                            </div>

                            {isExpanded && (
                              <div className="px-3 pb-3 pt-1 border-t border-gray-100 space-y-3 ml-6">
                                <p className="text-xs text-gray-500">{col.reasoning}</p>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                                    <select
                                      value={col.columnType}
                                      onChange={(e) => updateFileColumn(activeFile.id, col.index, 'columnType', e.target.value)}
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
                                      onChange={(e) => updateFileColumn(activeFile.id, col.index, 'semanticCategory', e.target.value || '')}
                                      className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                    >
                                      {SEMANTIC_CATEGORIES.map((sc) => (
                                        <option key={sc.value} value={sc.value}>{sc.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                                <div className="text-xs text-gray-400">
                                  Amostras: {activeFile.stats?.[col.index]?.sampleValues?.join(' · ') || '—'}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Confirm review button */}
                  {activeFile.step === 'review' && (
                    <button
                      onClick={confirmCurrentReview}
                      className="w-full py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Confirmar classificação
                      {reviewCount > 1 && ` · Próximo arquivo (${reviewCount - 1} restante${reviewCount - 1 !== 1 ? 's' : ''})`}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Process all button — visible when all are reviewed */}
          {allReviewed && reviewedCount > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-emerald-900">Todas as pesquisas revisadas</h3>
                  <p className="text-sm text-emerald-700">{reviewedCount} arquivo{reviewedCount !== 1 ? 's' : ''} pronto{reviewedCount !== 1 ? 's' : ''} para processar</p>
                </div>
                <button
                  onClick={processAllFiles}
                  className="px-6 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2"
                >
                  <Play className="w-4 h-4" />
                  Processar todos
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════ STEP: Processing ════════════ */}
      {step === 'processing' && (
        <div className="space-y-4">
          {files.map((entry) => (
            <div key={entry.id} className="bg-white rounded-xl border px-5 py-4 flex items-center gap-4">
              {entry.step === 'processing' && <Loader2 className="w-5 h-5 animate-spin text-emerald-600 shrink-0" />}
              {entry.step === 'done' && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
              {entry.step === 'error' && <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />}
              {entry.step === 'reviewed' && <div className="w-5 h-5 rounded-full bg-gray-200 shrink-0" />}
              {entry.step === 'duplicate' && <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{entry.name}</p>
                <p className="text-xs text-gray-500">
                  {entry.step === 'processing' && 'Processando...'}
                  {entry.step === 'done' && `${entry.processedCount} linhas processadas`}
                  {entry.step === 'error' && entry.error}
                  {entry.step === 'reviewed' && 'Aguardando...'}
                  {entry.step === 'duplicate' && 'Duplicado — ignorado'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════════════ STEP: Done ════════════ */}
      {step === 'done' && (
        <div className="bg-white rounded-xl border p-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Importação concluída!</h2>
          <p className="text-sm text-gray-500 mb-1">
            {doneCount} pesquisa{doneCount !== 1 ? 's' : ''} processada{doneCount !== 1 ? 's' : ''} · {totalProcessed} linhas no total
          </p>
          {errorCount > 0 && (
            <p className="text-sm text-red-500 mb-1">{errorCount} com erro</p>
          )}
          {duplicateCount > 0 && (
            <p className="text-sm text-amber-600 mb-1">{duplicateCount} duplicada{duplicateCount !== 1 ? 's' : ''} ignorada{duplicateCount !== 1 ? 's' : ''}</p>
          )}
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => router.push(basePath)}
              className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
            >
              Voltar para a turma
            </button>
            <button
              onClick={() => {
                setStep('upload')
                setFiles([])
                setActiveFileIndex(0)
                setError(null)
                setTotalProcessed(0)
              }}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Importar mais
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

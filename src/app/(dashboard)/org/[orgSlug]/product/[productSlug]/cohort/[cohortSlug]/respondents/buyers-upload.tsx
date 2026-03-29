'use client'

import { useState, useRef } from 'react'
import { Upload, X, CheckCircle, AlertCircle } from 'lucide-react'

interface BuyersUploadProps {
  cohortId: string
}

export function BuyersUpload({ cohortId }: BuyersUploadProps) {
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{
    matched: number
    total_in_file: number
    not_found: string[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleUpload(file: File) {
    setUploading(true)
    setError(null)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('cohort_id', cohortId)

    try {
      const res = await fetch('/api/respondents/buyers', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Erro ao processar arquivo')
        return
      }

      setResult(data)
    } catch {
      setError('Erro de conexão')
    } finally {
      setUploading(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
      >
        Marcar compradores
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Marcar compradores</h3>
          <button onClick={() => { setOpen(false); setResult(null); setError(null) }} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          Faça upload de um CSV com a coluna de email dos compradores.
          Todos os respondentes encontrados serão marcados automaticamente.
        </p>

        {!result && (
          <>
            <div
              className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center hover:border-emerald-300 transition-colors cursor-pointer"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-600">Arraste um CSV aqui ou clique para selecionar</p>
              <p className="text-xs text-gray-400 mt-1">O arquivo precisa ter uma coluna &quot;email&quot;</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleUpload(f)
                }}
              />
            </div>

            {uploading && (
              <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500">
                <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                Processando...
              </div>
            )}

            {error && (
              <div className="mt-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}
          </>
        )}

        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 bg-emerald-50 text-emerald-700 p-4 rounded-lg">
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">
                  {result.matched} de {result.total_in_file} emails encontrados
                </p>
                <p className="text-xs mt-0.5">
                  Respondentes marcados como compradores com sucesso.
                </p>
              </div>
            </div>

            {result.not_found.length > 0 && (
              <div className="bg-amber-50 p-3 rounded-lg">
                <p className="text-xs font-medium text-amber-700 mb-2">
                  {result.not_found.length} emails não encontrados:
                </p>
                <div className="max-h-32 overflow-y-auto text-xs text-amber-600 space-y-0.5">
                  {result.not_found.slice(0, 20).map((email) => (
                    <p key={email}>{email}</p>
                  ))}
                  {result.not_found.length > 20 && (
                    <p className="font-medium">... e mais {result.not_found.length - 20}</p>
                  )}
                </div>
              </div>
            )}

            <button
              onClick={() => { setOpen(false); setResult(null); window.location.reload() }}
              className="w-full py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

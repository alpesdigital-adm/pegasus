import { Bell } from 'lucide-react'

export default function AlertsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Alertas</h1>
        <p className="text-gray-500 text-sm mt-1">
          Notificações e alertas inteligentes sobre suas turmas
        </p>
      </div>

      <div className="bg-white rounded-xl border p-8 text-center">
        <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <Bell className="w-8 h-8 text-amber-600" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Em breve
        </h2>
        <p className="text-gray-500 text-sm max-w-md mx-auto">
          O sistema de alertas será ativado quando você importar dados de pesquisa.
          Você receberá notificações sobre variações de engajamento, novos padrões e oportunidades.
        </p>
      </div>
    </div>
  )
}

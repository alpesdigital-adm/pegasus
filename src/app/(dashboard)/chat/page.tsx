import { MessageSquare } from 'lucide-react'

export default function ChatPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Chat IA</h1>
        <p className="text-gray-500 text-sm mt-1">
          Converse com a IA sobre seus dados de audiência
        </p>
      </div>

      <div className="bg-white rounded-xl border p-8 text-center">
        <div className="w-16 h-16 bg-violet-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <MessageSquare className="w-8 h-8 text-violet-600" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Em breve
        </h2>
        <p className="text-gray-500 text-sm max-w-md mx-auto">
          O Chat IA estará disponível após a importação de dados de pesquisa.
          Você poderá fazer perguntas sobre sua audiência em linguagem natural.
        </p>
      </div>
    </div>
  )
}

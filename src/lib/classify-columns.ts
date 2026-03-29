import Anthropic from '@anthropic-ai/sdk'
import type { ColumnStats } from '@/lib/parsers/csv-xlsx'

export interface ColumnClassification {
  index: number
  header: string
  normalizedHeader: string
  columnType: string
  semanticCategory: string | null
  checkboxGroupName: string | null
  confidence: number
  reasoning: string
}

export interface ClassificationResult {
  columns: ColumnClassification[]
  detectedPlatform: string | null
  notes: string[]
}

const CLASSIFICATION_PROMPT = `Você é um classificador de colunas de pesquisas de lançamentos digitais brasileiros.

Analise os headers e amostras de dados de uma pesquisa e classifique cada coluna.

## Tipos de coluna (column_type)
- identifier_email: endereço de email
- identifier_name: nome da pessoa
- identifier_phone: telefone/WhatsApp
- identifier_doc: CPF, CRM, CNPJ
- identifier_social: Instagram, LinkedIn, etc.
- utm: campos utm_* (utm_source, utm_medium, utm_campaign, utm_term, utm_content)
- metadata_timestamp: datas, timestamps de envio do formulário
- metadata_system: Response Type, Network ID, Ending, "#", ID do formulário
- noise: confirmações "está correto?", templates {{field:}}, campos sempre "1" que confirmam campo anterior
- closed_multiple_choice: até ~10 opções distintas, respostas curtas e repetitivas
- closed_scale: valores numéricos em escala (0-5, 0-10, 1-5)
- closed_range: faixas ("até X", "de X a Y", "acima de X")
- closed_binary: Sim/Não, 0/1, Verdadeiro/Falso
- closed_checkbox_group: header = opção, valor = repetição exata do header quando marcado, vazio quando não
- semi_closed: texto livre mas com padrões repetitivos (poucas variações)
- open: texto livre com respostas únicas e longas
- sale_product_name: nome do produto comprado (em listas de vendas)
- sale_amount: valor pago / preço
- sale_payment_method: forma de pagamento (cartão, boleto, pix)
- sale_installments: número de parcelas
- sale_date: data da compra/transação

## Categorias semânticas (semantic_category) — aplicar quando relevante
- qualification: quem é a pessoa (papel, profissão) — "Quem é você?", "Eu sou"
- professional_profile: perfil profissional — "Área de atuação", "Tempo como médico"
- revenue_current: faturamento/renda atual
- revenue_desired: faturamento/renda desejado
- pain_challenge: dores, desafios, dificuldades
- desire_goal: desejos, objetivos, aspirações
- purchase_intent: intenção de compra
- purchase_decision: decisão/motivação de compra
- purchase_objection: objeção ou razão de não compra
- experience_time: tempo de experiência
- how_discovered: como conheceu
- feedback: avaliação, nota, depoimento
- hypothetical: pergunta hipotética
- content_request: conteúdo desejado
- personal_data: dados pessoais (endereço, nascimento)
- investment_willingness: disposição de investimento
- engagement_checklist: checkboxes de desejos/objetivos

## Detecção de checkbox N-col (CRÍTICO)
Se encontrar colunas consecutivas onde:
1. O header parece ser uma OPÇÃO (não uma pergunta)
2. Os valores quando presentes SÃO IGUAIS ao header
3. São 2+ colunas seguidas com esse padrão
→ Classifique como closed_checkbox_group com checkbox_group_name = nome do grupo inferido

## Regras
- Campos "#" do Typeform são metadata_system
- "Response Type", "Network ID", "Ending" são metadata_system
- Headers com "está correto?" + valor sempre "1" são noise
- UTMs com valor "xxxxx" em todas as linhas: ainda classificar como utm
- Se o header contém email/e-mail E os valores parecem emails → identifier_email
- Se não souber a categoria semântica, retorne null
- Para listas de vendas: colunas com nomes de produtos (curso, mentoria, consultoria) → sale_product_name
- Valores em R$ ou números decimais que parecem preços → sale_amount
- "Cartão", "Boleto", "Pix", "Crédito" → sale_payment_method
- Números pequenos (1-24) que indicam parcelas → sale_installments

Responda EXCLUSIVAMENTE com JSON válido, sem markdown, sem explicações fora do JSON.`

export async function classifyColumns(
  headers: string[],
  stats: ColumnStats[],
  sampleRows: string[][],
  checkboxGroups: { groupName: string; columnIndices: number[] }[]
): Promise<ClassificationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY não configurada')
  }

  const anthropic = new Anthropic({ apiKey })

  // Build input for the LLM
  // Pre-index checkbox groups for O(1) lookup instead of O(n) per column
  const checkboxGroupMap = new Map<number, string>()
  for (const g of checkboxGroups) {
    for (const idx of g.columnIndices) {
      checkboxGroupMap.set(idx, g.groupName)
    }
  }

  const columnsInput = stats.map((stat, i) => ({
    index: i,
    header: headers[i],
    uniqueValues: stat.uniqueCount,
    fillRate: Math.round(stat.fillRate * 100) + '%',
    avgLength: Math.round(stat.avgLength),
    samples: stat.sampleValues.slice(0, 5), // Limit samples to reduce payload
    preDetectedCheckboxGroup: checkboxGroupMap.get(i) ?? null,
  }))

  // Include 3 sample rows with truncated values
  const sampleData = sampleRows.slice(0, 3).map((row) => {
    const rowObj: Record<string, string> = {}
    headers.forEach((h, i) => {
      if (row[i] && row[i].trim()) {
        rowObj[h] = row[i].substring(0, 100) // Truncate to reduce payload
      }
    })
    return rowObj
  })

  const userMessage = `Classifique estas ${headers.length} colunas de uma pesquisa de lançamento digital.

## Dados das colunas
${JSON.stringify(columnsInput, null, 2)}

## 3 linhas de amostra
${JSON.stringify(sampleData, null, 2)}

## Grupos de checkbox pré-detectados
${JSON.stringify(checkboxGroups, null, 2)}

Retorne JSON neste formato exato:
{
  "columns": [
    {
      "index": 0,
      "header": "header original",
      "normalizedHeader": "header normalizado",
      "columnType": "tipo",
      "semanticCategory": "categoria ou null",
      "checkboxGroupName": "nome do grupo ou null",
      "confidence": 0.95,
      "reasoning": "explicação curta"
    }
  ],
  "detectedPlatform": "typeform ou google_forms ou null",
  "notes": ["observações relevantes"]
}`

  // Haiku is faster and cheaper; classification is a structured extraction task
  // that doesn't need Sonnet-level reasoning
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    messages: [
      { role: 'user', content: userMessage },
    ],
    system: CLASSIFICATION_PROMPT,
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  // Parse JSON response — handle potential markdown wrapping
  let jsonStr = text.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  try {
    const result = JSON.parse(jsonStr) as ClassificationResult
    return result
  } catch {
    console.error('Failed to parse LLM response:', text)
    throw new Error('Falha ao interpretar classificação do LLM')
  }
}

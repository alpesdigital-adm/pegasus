import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a normalized_header (snake_case slug) into human-readable text.
 *
 * "em_uma_escala_de_0_a_10_o_quanto_voce_acredita"
 * → "Em uma escala de 0 a 10, o quanto você acredita"
 *
 * Handles: underscores → spaces, first letter uppercase,
 * common PT-BR accent restoration, punctuation heuristics.
 */
export function formatHeader(header: string): string {
  if (!header) return ''

  let text = header
    // Underscores → spaces
    .replace(/_/g, ' ')
    // Collapse multiple spaces
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Restore common PT-BR accented words
  const accentMap: Record<string, string> = {
    'voce': 'você',
    'e': 'é',
    'numero': 'número',
    'area': 'área',
    'medico': 'médico',
    'especializacao': 'especialização',
    'experiencia': 'experiência',
    'faturamento': 'faturamento',
    'renda': 'renda',
    'profissao': 'profissão',
    'opiniao': 'opinião',
    'situacao': 'situação',
    'informacao': 'informação',
    'nao': 'não',
    'tambem': 'também',
    'ate': 'até',
    'ja': 'já',
    'pais': 'país',
    'pos': 'pós',
    'pre': 'pré',
    'saude': 'saúde',
    'objecao': 'objeção',
    'decisao': 'decisão',
    'intencao': 'intenção',
    'tricologia': 'tricologia',
    'media': 'média',
    'medio': 'médio',
    'publico': 'público',
    'conteudo': 'conteúdo',
    'qual': 'qual',
  }

  // Apply accent restoration word by word
  text = text
    .split(' ')
    .map((word) => accentMap[word.toLowerCase()] || word)
    .join(' ')

  // Capitalize first letter
  text = text.charAt(0).toUpperCase() + text.slice(1)

  // Add question mark at the end if it looks like a question
  const questionStarters = /^(qual|como|quanto|quant[oa]s|onde|quando|por que|o que|em uma escala|considerando|você)/i
  if (questionStarters.test(text) && !text.endsWith('?')) {
    text += '?'
  }

  return text
}

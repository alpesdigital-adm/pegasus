import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export interface ParsedData {
  headers: string[]
  rows: string[][]
  totalRows: number
  previewRows: string[][] // first 5 rows
  stats: ColumnStats[]
}

export interface ColumnStats {
  index: number
  header: string
  uniqueCount: number
  fillRate: number
  avgLength: number
  sampleValues: string[]
  allEmpty: boolean
}

/**
 * Parse CSV or XLSX buffer into structured data
 */
export function parseFile(
  buffer: Buffer,
  filename: string
): ParsedData {
  const ext = filename.toLowerCase().split('.').pop()

  let headers: string[]
  let rows: string[][]

  if (ext === 'xlsx' || ext === 'xls') {
    const result = parseXlsx(buffer)
    headers = result.headers
    rows = result.rows
  } else {
    const result = parseCsv(buffer)
    headers = result.headers
    rows = result.rows
  }

  // Normalize headers
  headers = headers.map(normalizeHeader)

  // Compute stats per column
  const stats = headers.map((header, index) => computeColumnStats(index, header, rows))

  return {
    headers,
    rows,
    totalRows: rows.length,
    previewRows: rows.slice(0, 5),
    stats,
  }
}

function parseCsv(buffer: Buffer): { headers: string[]; rows: string[][] } {
  const text = buffer.toString('utf-8')

  // Detect separator (comma, semicolon, tab)
  const firstLine = text.split('\n')[0] || ''
  const semicolons = (firstLine.match(/;/g) || []).length
  const commas = (firstLine.match(/,/g) || []).length
  const tabs = (firstLine.match(/\t/g) || []).length
  let delimiter = ','
  if (semicolons > commas && semicolons > tabs) delimiter = ';'
  if (tabs > commas && tabs > semicolons) delimiter = '\t'

  const result = Papa.parse(text, {
    delimiter,
    skipEmptyLines: true,
  })

  const data = result.data as string[][]
  if (data.length === 0) return { headers: [], rows: [] }

  const headers = data[0]
  const rows = data.slice(1).filter((row) => row.some((cell) => cell.trim() !== ''))

  return { headers, rows }
}

function parseXlsx(buffer: Buffer): { headers: string[]; rows: string[][] } {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]

  const data = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  })

  if (data.length === 0) return { headers: [], rows: [] }

  const headers = (data[0] as string[]).map(String)
  const rows = data.slice(1).map((row) =>
    (row as string[]).map((cell) => (cell === undefined || cell === null ? '' : String(cell)))
  )

  return { headers, rows }
}

/**
 * Normalize header: remove markdown, Typeform templates, trim
 */
export function normalizeHeader(header: string): string {
  let h = header
  // Remove Typeform field references {{field:uuid}}
  h = h.replace(/\{\{field:[^}]+\}\}/g, '')
  // Remove markdown bold/italic markers
  h = h.replace(/\*+/g, '')
  // Remove line breaks
  h = h.replace(/[\r\n]+/g, ' ')
  // Collapse multiple spaces
  h = h.replace(/\s+/g, ' ')
  // Trim
  h = h.trim()
  return h
}

function computeColumnStats(
  index: number,
  header: string,
  rows: string[][]
): ColumnStats {
  const values = rows.map((row) => (row[index] || '').trim())
  const nonEmpty = values.filter((v) => v !== '')
  const unique = new Set(nonEmpty)

  const totalLength = nonEmpty.reduce((sum, v) => sum + v.length, 0)

  // Sample: up to 5 unique non-empty values
  const sampleValues = Array.from(unique).slice(0, 5)

  return {
    index,
    header,
    uniqueCount: unique.size,
    fillRate: rows.length > 0 ? nonEmpty.length / rows.length : 0,
    avgLength: nonEmpty.length > 0 ? totalLength / nonEmpty.length : 0,
    allEmpty: nonEmpty.length === 0,
    sampleValues,
  }
}

/**
 * Detect potential checkbox N-col groups
 * Pattern: consecutive columns where header = value when marked
 */
export function detectCheckboxGroups(
  headers: string[],
  rows: string[][]
): { groupName: string; columnIndices: number[] }[] {
  const groups: { groupName: string; columnIndices: number[] }[] = []
  let currentGroup: number[] = []

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]
    const values = rows.map((row) => (row[i] || '').trim())
    const nonEmpty = values.filter((v) => v !== '')

    // Check if all non-empty values equal the header (checkbox pattern)
    const isCheckbox =
      nonEmpty.length > 0 &&
      nonEmpty.every((v) => v === header) &&
      // Header should look like an option, not a question (typically shorter)
      header.length < 80

    if (isCheckbox) {
      currentGroup.push(i)
    } else {
      if (currentGroup.length >= 2) {
        // This is a checkbox group
        groups.push({
          groupName: inferGroupName(headers, currentGroup),
          columnIndices: [...currentGroup],
        })
      }
      currentGroup = []
    }
  }

  // Check last group
  if (currentGroup.length >= 2) {
    groups.push({
      groupName: inferGroupName(headers, currentGroup),
      columnIndices: [...currentGroup],
    })
  }

  return groups
}

function inferGroupName(headers: string[], indices: number[]): string {
  // Look at the column BEFORE the group for a question header
  const firstIndex = indices[0]
  if (firstIndex > 0) {
    const prevHeader = headers[firstIndex - 1]
    // If previous header looks like a question (contains "?")
    if (prevHeader.includes('?')) {
      return prevHeader
    }
  }

  // Otherwise, try to infer from the options
  const options = indices.map((i) => headers[i])
  if (options.length <= 5) {
    return `Seleção: ${options.join(', ')}`
  }
  return `Grupo de ${options.length} opções (a partir de "${options[0]}")`
}

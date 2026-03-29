/**
 * ICP Engine — Column Deduplication
 *
 * Pure functions. Detects and merges semantically equivalent columns
 * from different surveys (e.g. "voce_e" and "tipo_medico" both asking
 * about medical specialty).
 *
 * Strategy (multi-signal scoring):
 * 1. Normalized header word overlap (Jaccard similarity)
 * 2. Same semantic category
 * 3. Answer value overlap (if two columns share similar answer sets,
 *    they likely ask the same question)
 * 4. Respondent answer agreement (if a respondent answered both columns
 *    with the same value, strong signal)
 *
 * Output: groups of column IDs that should be treated as one canonical field.
 */

import type { ColumnMeta, RespondentRow } from './types'

// ─── Types ───────────────────────────────────────────────────

export interface ColumnGroup {
  /** Canonical column ID (the one with most answers, used as representative) */
  canonicalId: string
  /** All column IDs in this group */
  memberIds: string[]
  /** Merged metadata */
  meta: ColumnMeta
  /** Similarity score that caused the merge (for debugging) */
  mergeScore: number
}

export interface DeduplicationResult {
  /** Deduplicated column groups */
  groups: ColumnGroup[]
  /** Map from original columnId → canonical columnId */
  columnMapping: Map<string, string>
  /** Number of columns before dedup */
  originalCount: number
  /** Number after dedup */
  deduplicatedCount: number
}

// ─── String Similarity ───────────────────────────────────────

/**
 * Tokenize a normalized header into meaningful words.
 * Removes common stopwords and very short tokens.
 */
function tokenize(header: string): Set<string> {
  const stopwords = new Set([
    'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
    'um', 'uma', 'o', 'a', 'os', 'as', 'e', 'ou', 'que', 'com',
    'para', 'por', 'seu', 'sua', 'qual', 'como', 'voce', 'você',
    'the', 'is', 'of', 'and', 'in', 'to', 'for', 'your',
  ])

  const tokens = header
    .toLowerCase()
    .replace(/[_\-\/\\.,;:!?()[\]{}'"]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stopwords.has(t))

  return new Set(tokens)
}

/**
 * Jaccard similarity between two token sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection++
  }
  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

/**
 * Check if one set of tokens is a subset/superset of the other
 * (handles cases like "pais" vs "qual_seu_pais")
 */
function containmentScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection++
  }
  const smaller = Math.min(a.size, b.size)
  return smaller > 0 ? intersection / smaller : 0
}

// ─── Answer Overlap ──────────────────────────────────────────

/**
 * Calculate the overlap between answer value sets of two columns.
 * High overlap = likely asking the same question.
 */
function answerValueOverlap(
  valuesA: string[],
  valuesB: string[]
): number {
  if (valuesA.length === 0 || valuesB.length === 0) return 0

  const setA = new Set(valuesA.map((v) => v.toLowerCase().trim()))
  const setB = new Set(valuesB.map((v) => v.toLowerCase().trim()))

  let intersection = 0
  for (const v of setA) {
    if (setB.has(v)) intersection++
  }

  const smaller = Math.min(setA.size, setB.size)
  return smaller > 0 ? intersection / smaller : 0
}

/**
 * Check how often respondents who answered both columns gave the same answer.
 */
function respondentAgreement(
  rows: RespondentRow[],
  colIdA: string,
  colIdB: string
): number {
  let both = 0
  let agree = 0

  for (const row of rows) {
    const a = row.answers[colIdA]
    const b = row.answers[colIdB]

    if (a && b) {
      both++
      if (a.toLowerCase().trim() === b.toLowerCase().trim()) {
        agree++
      }
    }
  }

  return both > 0 ? agree / both : 0
}

// ─── Composite Similarity ────────────────────────────────────

interface SimilaritySignals {
  headerJaccard: number
  headerContainment: number
  sameCategory: boolean
  answerOverlap: number
  respondentAgreement: number
}

function computeCompositeSimilarity(signals: SimilaritySignals): number {
  let score = 0

  // Header similarity (weight: 0.3)
  const headerScore = Math.max(signals.headerJaccard, signals.headerContainment * 0.8)
  score += headerScore * 0.3

  // Same semantic category (weight: 0.15)
  if (signals.sameCategory) {
    score += 0.15
  }

  // Answer value overlap (weight: 0.25)
  score += signals.answerOverlap * 0.25

  // Respondent agreement (weight: 0.3 — strongest signal)
  score += signals.respondentAgreement * 0.3

  return score
}

// ─── Main Deduplication ──────────────────────────────────────

const MERGE_THRESHOLD = 0.5

/**
 * Deduplicate columns by detecting semantically equivalent ones.
 *
 * @param columns - All column metadata
 * @param rows - Respondent rows with answers (used for agreement check)
 * @param threshold - Minimum composite similarity to merge (default: 0.5)
 * @returns DeduplicationResult with grouped columns and mapping
 */
export function deduplicateColumns(
  columns: ColumnMeta[],
  rows: RespondentRow[],
  threshold: number = MERGE_THRESHOLD
): DeduplicationResult {
  if (columns.length <= 1) {
    return {
      groups: columns.map((c) => ({
        canonicalId: c.columnId,
        memberIds: [c.columnId],
        meta: c,
        mergeScore: 1,
      })),
      columnMapping: new Map(columns.map((c) => [c.columnId, c.columnId])),
      originalCount: columns.length,
      deduplicatedCount: columns.length,
    }
  }

  // Pre-compute tokens for all columns
  const tokens = new Map<string, Set<string>>()
  for (const col of columns) {
    tokens.set(col.columnId, tokenize(col.normalizedHeader))
  }

  // Count answers per column (to determine canonical = most answers)
  const answerCounts = new Map<string, number>()
  for (const col of columns) {
    let count = 0
    for (const row of rows) {
      if (row.answers[col.columnId]) count++
    }
    answerCounts.set(col.columnId, count)
  }

  // Compute pairwise similarity
  type Pair = { i: number; j: number; score: number; signals: SimilaritySignals }
  const pairs: Pair[] = []

  for (let i = 0; i < columns.length; i++) {
    for (let j = i + 1; j < columns.length; j++) {
      const colA = columns[i]
      const colB = columns[j]

      const tokensA = tokens.get(colA.columnId)!
      const tokensB = tokens.get(colB.columnId)!

      const signals: SimilaritySignals = {
        headerJaccard: jaccardSimilarity(tokensA, tokensB),
        headerContainment: containmentScore(tokensA, tokensB),
        sameCategory:
          colA.semanticCategory != null &&
          colB.semanticCategory != null &&
          colA.semanticCategory === colB.semanticCategory,
        answerOverlap: answerValueOverlap(
          colA.distinctValues,
          colB.distinctValues
        ),
        respondentAgreement: respondentAgreement(rows, colA.columnId, colB.columnId),
      }

      const score = computeCompositeSimilarity(signals)

      if (score >= threshold) {
        pairs.push({ i, j, score, signals })
      }
    }
  }

  // Sort pairs by score descending
  pairs.sort((a, b) => b.score - a.score)

  // Union-Find for grouping
  const parent = new Map<number, number>()
  function find(x: number): number {
    if (!parent.has(x)) parent.set(x, x)
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
    return parent.get(x)!
  }
  function union(x: number, y: number) {
    const px = find(x)
    const py = find(y)
    if (px !== py) parent.set(px, py)
  }

  // Merge pairs
  for (const pair of pairs) {
    union(pair.i, pair.j)
  }

  // Build groups
  const groupMap = new Map<number, number[]>()
  for (let i = 0; i < columns.length; i++) {
    const root = find(i)
    if (!groupMap.has(root)) groupMap.set(root, [])
    groupMap.get(root)!.push(i)
  }

  const groups: ColumnGroup[] = []
  const columnMapping = new Map<string, string>()

  for (const [, memberIndices] of groupMap) {
    const memberCols = memberIndices.map((i) => columns[i])

    // Canonical = the one with most answers
    memberCols.sort(
      (a, b) =>
        (answerCounts.get(b.columnId) || 0) - (answerCounts.get(a.columnId) || 0)
    )

    const canonical = memberCols[0]

    // Merge distinct values
    const allValues = new Set<string>()
    for (const col of memberCols) {
      for (const v of col.distinctValues) allValues.add(v)
    }

    // Find the merge score (max pairwise score in this group)
    let maxScore = 1
    if (memberCols.length > 1) {
      for (const pair of pairs) {
        if (
          memberIndices.includes(pair.i) &&
          memberIndices.includes(pair.j)
        ) {
          maxScore = Math.max(maxScore, pair.score)
        }
      }
    }

    const group: ColumnGroup = {
      canonicalId: canonical.columnId,
      memberIds: memberCols.map((c) => c.columnId),
      meta: {
        ...canonical,
        distinctValues: Array.from(allValues),
      },
      mergeScore: maxScore,
    }

    groups.push(group)

    for (const col of memberCols) {
      columnMapping.set(col.columnId, canonical.columnId)
    }
  }

  return {
    groups,
    columnMapping,
    originalCount: columns.length,
    deduplicatedCount: groups.length,
  }
}

/**
 * Remap respondent answers using the column mapping.
 * Merged columns have their answers consolidated: if a respondent
 * has no answer for the canonical column but has one for a member,
 * use the member's answer.
 */
export function remapAnswers(
  rows: RespondentRow[],
  dedup: DeduplicationResult
): RespondentRow[] {
  // Build reverse map: canonical → all member IDs
  const groupMembers = new Map<string, string[]>()
  for (const group of dedup.groups) {
    groupMembers.set(group.canonicalId, group.memberIds)
  }

  return rows.map((row) => {
    const newAnswers: Record<string, string> = {}

    for (const [canonicalId, memberIds] of groupMembers) {
      // Find first non-empty answer among members
      let value: string | undefined
      for (const memberId of memberIds) {
        if (row.answers[memberId]) {
          value = row.answers[memberId]
          break
        }
      }
      if (value) {
        newAnswers[canonicalId] = value
      }
    }

    return {
      ...row,
      answers: newAnswers,
    }
  })
}

/**
 * ICP Engine — Profile Generator
 *
 * Orchestrates: decision tree → avatar paths → ICP profiles with rules.
 * Pure function: receives data, returns profiles. No DB dependency.
 *
 * For each avatar discovered by the tree:
 * 1. Identifies the tree conditions (the path)
 * 2. Analyzes the distribution of buyer answers within the avatar
 * 3. Generates closed_rules with weights based on semantic category
 * 4. Calculates conversion probability = buyers / total in that segment
 */

import type {
  RespondentRow,
  ColumnMeta,
  AvatarProfile,
  AvatarPath,
  ClosedRule,
  RuleType,
  ICPGenerationResult,
  TreeConfig,
  ScoringWeights,
} from './types'
import { DEFAULT_TREE_CONFIG, DEFAULT_SCORING_WEIGHTS } from './types'
import { buildDecisionTree, extractAvatarPaths } from './decision-tree'

// ─── Distribution Analysis ───────────────────────────────────

interface ValueDistribution {
  value: string
  count: number
  percentage: number
}

function getDistribution(
  rows: RespondentRow[],
  columnId: string
): ValueDistribution[] {
  const counts = new Map<string, number>()
  let total = 0

  for (const row of rows) {
    const val = row.answers[columnId]
    if (val != null && val !== '') {
      counts.set(val, (counts.get(val) || 0) + 1)
      total++
    }
  }

  return Array.from(counts.entries())
    .map(([value, count]) => ({
      value,
      count,
      percentage: total > 0 ? count / total : 0,
    }))
    .sort((a, b) => b.percentage - a.percentage)
}

/**
 * Classify a distribution into a rule type based on concentration:
 * - >60% same value → must_match
 * - 30-60% → prefer
 * - <30% → ignore (returns null)
 */
function classifyRule(
  distribution: ValueDistribution[],
  minThreshold: number = 0.3
): { type: RuleType; matchValues: string[]; topPercentage: number } | null {
  if (distribution.length === 0) return null

  // Check if top value(s) combined exceed thresholds
  const top = distribution[0]

  if (top.percentage >= 0.6) {
    return {
      type: 'must_match',
      matchValues: [top.value],
      topPercentage: top.percentage,
    }
  }

  // Check if top 2-3 values combined form a strong signal
  let cumulative = 0
  const strongValues: string[] = []
  for (const item of distribution) {
    if (item.percentage < 0.1) break // stop at values below 10%
    cumulative += item.percentage
    strongValues.push(item.value)
    if (cumulative >= 0.6) {
      return {
        type: 'prefer',
        matchValues: strongValues,
        topPercentage: cumulative,
      }
    }
  }

  if (cumulative >= minThreshold && strongValues.length > 0) {
    return {
      type: 'prefer',
      matchValues: strongValues,
      topPercentage: cumulative,
    }
  }

  return null
}

// ─── Label Generation ────────────────────────────────────────

function generateAvatarLabel(
  path: AvatarPath,
  columns: ColumnMeta[],
  index: number
): string {
  // Try to build a descriptive label from the tree conditions
  const parts: string[] = []

  for (const cond of path.conditions) {
    if (cond.operator === 'in' && cond.values.length <= 2) {
      const shortValues = cond.values
        .map((v) => (v.length > 30 ? v.substring(0, 27) + '...' : v))
        .join(' / ')
      parts.push(shortValues)
    }
  }

  if (parts.length > 0) {
    return `Avatar ${index}: ${parts.join(' + ')}`
  }

  return `Avatar ${index}`
}

function generateAvatarDescription(
  path: AvatarPath,
  buyerDistributions: Map<string, ValueDistribution[]>,
  columns: ColumnMeta[]
): string {
  const traits: string[] = []

  for (const cond of path.conditions) {
    const col = columns.find((c) => c.columnId === cond.columnId)
    const header = col?.normalizedHeader || cond.header
    if (cond.operator === 'in') {
      traits.push(`${header}: ${cond.values.join(', ')}`)
    }
  }

  // Add top distinguishing traits from distributions
  for (const [colId, dist] of buyerDistributions) {
    const col = columns.find((c) => c.columnId === colId)
    if (!col || !col.semanticCategory) continue
    if (dist.length > 0 && dist[0].percentage >= 0.5) {
      const existing = traits.find((t) => t.startsWith(col.normalizedHeader))
      if (!existing) {
        traits.push(`${col.normalizedHeader}: ${dist[0].value} (${Math.round(dist[0].percentage * 100)}%)`)
      }
    }
  }

  return traits.slice(0, 5).join(' · ')
}

// ─── Main Generator ──────────────────────────────────────────

function getWeight(
  semanticCategory: string | null,
  weights: ScoringWeights
): number {
  if (!semanticCategory) return weights.default
  return (weights as unknown as Record<string, number>)[semanticCategory] ?? weights.default
}

function buildAvatarProfile(
  path: AvatarPath,
  allRows: RespondentRow[],
  columns: ColumnMeta[],
  avatarIndex: number,
  totalBuyers: number,
  weights: ScoringWeights
): AvatarProfile {
  // Get rows that fall into this avatar's leaf
  const leafIds = new Set(path.leaf.respondentIds)
  const avatarRows = allRows.filter((r) => leafIds.has(r.respondentId))
  const avatarBuyers = avatarRows.filter((r) => r.isBuyer)

  // For each relevant column, analyze buyer distribution within this avatar
  const closedRules: ClosedRule[] = []
  const buyerDistributions = new Map<string, ValueDistribution[]>()

  // Only analyze columns that are analytical (not identifiers, not noise)
  const analyticalColumns = columns.filter(
    (c) =>
      c.columnType.startsWith('closed_') ||
      c.columnType === 'semi_closed'
  )

  for (const col of analyticalColumns) {
    const buyerDist = getDistribution(avatarBuyers, col.columnId)
    buyerDistributions.set(col.columnId, buyerDist)

    const ruleClassification = classifyRule(buyerDist)
    if (!ruleClassification) continue

    const weight = getWeight(col.semanticCategory, weights)

    closedRules.push({
      columnId: col.columnId,
      header: col.normalizedHeader,
      semanticCategory: col.semanticCategory,
      matchValues: ruleClassification.matchValues,
      weight,
      type: ruleClassification.type,
      buyerPercentage: ruleClassification.topPercentage,
    })
  }

  // Sort rules: must_match first, then by weight desc
  closedRules.sort((a, b) => {
    const typeOrder: Record<RuleType, number> = {
      must_match: 0,
      strong_signal: 1,
      prefer: 2,
    }
    const typeDiff = typeOrder[a.type] - typeOrder[b.type]
    if (typeDiff !== 0) return typeDiff
    return b.weight - a.weight
  })

  const label = generateAvatarLabel(path, columns, avatarIndex)
  const description = generateAvatarDescription(path, buyerDistributions, columns)

  return {
    index: avatarIndex,
    label,
    description,
    closedRules,
    conversionProbability: path.leaf.conversionRate,
    buyerCount: path.leaf.buyerCount,
    totalMatchCount: path.leaf.totalCount,
    buyerCoverage: totalBuyers > 0 ? path.leaf.buyerCount / totalBuyers : 0,
    treeConditions: path.conditions,
  }
}

/**
 * Generate ICP profiles (avatars) from respondent data.
 *
 * @param rows - All respondents with answers and buyer flag
 * @param columns - Column metadata for analytical columns
 * @param treeConfig - Decision tree configuration
 * @param scoringWeights - Weights per semantic category
 * @returns ICPGenerationResult with 1-3 avatar profiles
 */
export function generateICPProfiles(
  rows: RespondentRow[],
  columns: ColumnMeta[],
  treeConfig: TreeConfig = DEFAULT_TREE_CONFIG,
  scoringWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS
): ICPGenerationResult {
  const totalBuyers = rows.filter((r) => r.isBuyer).length
  const totalRespondents = rows.length

  // Guard: need minimum buyers
  if (totalBuyers < 10) {
    return {
      avatars: [],
      totalBuyers,
      totalRespondents,
      totalBuyerCoverage: 0,
      columnsUsed: columns,
      generatedAt: new Date().toISOString(),
    }
  }

  // Build decision tree
  const tree = buildDecisionTree(rows, columns, treeConfig)

  // Extract avatar paths
  const paths = extractAvatarPaths(tree, columns, treeConfig)

  // If no paths meet criteria, fall back to a single global avatar
  if (paths.length === 0) {
    const globalPath: AvatarPath = {
      conditions: [],
      leaf: {
        totalCount: totalRespondents,
        buyerCount: totalBuyers,
        conversionRate: totalBuyers / totalRespondents,
        respondentIds: rows.map((r) => r.respondentId),
      },
    }

    const avatar = buildAvatarProfile(
      globalPath,
      rows,
      columns,
      1,
      totalBuyers,
      scoringWeights
    )
    avatar.label = 'Avatar 1: Perfil geral'

    return {
      avatars: [avatar],
      totalBuyers,
      totalRespondents,
      totalBuyerCoverage: 1,
      columnsUsed: columns,
      generatedAt: new Date().toISOString(),
    }
  }

  // Build avatar profiles from paths
  const avatars = paths.map((path, i) =>
    buildAvatarProfile(path, rows, columns, i + 1, totalBuyers, scoringWeights)
  )

  // Calculate total buyer coverage (union of all avatars)
  const coveredBuyerIds = new Set<string>()
  for (const path of paths) {
    for (const id of path.leaf.respondentIds) {
      // We need to check if these are buyers — use the rows data
      const row = rows.find((r) => r.respondentId === id)
      if (row?.isBuyer) coveredBuyerIds.add(id)
    }
  }
  const totalBuyerCoverage = totalBuyers > 0 ? coveredBuyerIds.size / totalBuyers : 0

  return {
    avatars,
    totalBuyers,
    totalRespondents,
    totalBuyerCoverage,
    columnsUsed: columns,
    generatedAt: new Date().toISOString(),
  }
}

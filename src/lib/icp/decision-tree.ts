/**
 * ICP Engine — Decision Tree (CART for categorical data)
 *
 * Pure functions. Zero dependencies beyond ./types.
 * Input: array of RespondentRow + config.
 * Output: TreeNode (root) + extracted AvatarPaths.
 *
 * Uses Gini impurity to find best splits.
 * Handles only categorical (string) features.
 */

import type {
  RespondentRow,
  ColumnMeta,
  TreeNode,
  TreeSplit,
  TreeLeaf,
  TreeConfig,
  AvatarPath,
  AvatarCondition,
} from './types'
import { DEFAULT_TREE_CONFIG } from './types'

// ─── Gini Impurity ───────────────────────────────────────────

function gini(buyerCount: number, total: number): number {
  if (total === 0) return 0
  const p = buyerCount / total
  return 1 - p * p - (1 - p) * (1 - p)
}

function weightedGini(
  leftBuyers: number,
  leftTotal: number,
  rightBuyers: number,
  rightTotal: number
): number {
  const total = leftTotal + rightTotal
  if (total === 0) return 0
  return (
    (leftTotal / total) * gini(leftBuyers, leftTotal) +
    (rightTotal / total) * gini(rightBuyers, rightTotal)
  )
}

// ─── Find Best Split ─────────────────────────────────────────

interface CandidateSplit {
  columnId: string
  splitValues: string[]
  gain: number
  yesRows: RespondentRow[]
  noRows: RespondentRow[]
}

/**
 * For a given column, finds the best binary split.
 *
 * Strategy: for each distinct value (or group of values),
 * check if splitting on "value in set" vs "not in set"
 * reduces Gini impurity the most.
 *
 * For columns with many distinct values, we test each value
 * individually (one-vs-rest) and also test the top-N buyer-heavy
 * values as a group.
 */
function findBestSplitForColumn(
  rows: RespondentRow[],
  columnId: string,
  distinctValues: string[]
): CandidateSplit | null {
  const totalBuyers = rows.filter((r) => r.isBuyer).length
  const parentGini = gini(totalBuyers, rows.length)

  if (parentGini === 0) return null // pure node

  let bestSplit: CandidateSplit | null = null
  let bestGain = 0

  // Strategy 1: one-vs-rest for each distinct value
  for (const value of distinctValues) {
    const yesRows = rows.filter((r) => r.answers[columnId] === value)
    const noRows = rows.filter((r) => r.answers[columnId] !== value)

    if (yesRows.length === 0 || noRows.length === 0) continue

    const yesBuyers = yesRows.filter((r) => r.isBuyer).length
    const noBuyers = noRows.filter((r) => r.isBuyer).length

    const wg = weightedGini(yesBuyers, yesRows.length, noBuyers, noRows.length)
    const gain = parentGini - wg

    if (gain > bestGain) {
      bestGain = gain
      bestSplit = {
        columnId,
        splitValues: [value],
        gain,
        yesRows,
        noRows,
      }
    }
  }

  // Strategy 2: group values by buyer concentration
  // Find values where buyer rate > overall buyer rate
  if (distinctValues.length > 2 && distinctValues.length <= 20) {
    const overallRate = totalBuyers / rows.length
    const highBuyerValues = distinctValues.filter((v) => {
      const vRows = rows.filter((r) => r.answers[columnId] === v)
      const vBuyers = vRows.filter((r) => r.isBuyer).length
      return vRows.length >= 2 && vBuyers / vRows.length > overallRate
    })

    if (highBuyerValues.length > 0 && highBuyerValues.length < distinctValues.length) {
      const yesRows = rows.filter((r) => highBuyerValues.includes(r.answers[columnId]))
      const noRows = rows.filter((r) => !highBuyerValues.includes(r.answers[columnId]))

      if (yesRows.length > 0 && noRows.length > 0) {
        const yesBuyers = yesRows.filter((r) => r.isBuyer).length
        const noBuyers = noRows.filter((r) => r.isBuyer).length

        const wg = weightedGini(yesBuyers, yesRows.length, noBuyers, noRows.length)
        const gain = parentGini - wg

        if (gain > bestGain) {
          bestGain = gain
          bestSplit = {
            columnId,
            splitValues: highBuyerValues,
            gain,
            yesRows,
            noRows,
          }
        }
      }
    }
  }

  return bestSplit
}

// ─── Build Tree ──────────────────────────────────────────────

function buildTreeNode(
  rows: RespondentRow[],
  columns: ColumnMeta[],
  usedColumnIds: Set<string>,
  depth: number,
  config: TreeConfig
): TreeNode {
  const buyerCount = rows.filter((r) => r.isBuyer).length
  const conversionRate = rows.length > 0 ? buyerCount / rows.length : 0

  // Base cases: create leaf
  if (
    depth >= config.maxDepth ||
    rows.length < config.minLeafSize * 2 ||
    buyerCount === 0 ||
    buyerCount === rows.length
  ) {
    return {
      depth,
      leaf: {
        totalCount: rows.length,
        buyerCount,
        conversionRate,
        respondentIds: rows.map((r) => r.respondentId),
      },
    }
  }

  // Find the best split across all available columns
  let bestSplit: CandidateSplit | null = null

  for (const col of columns) {
    if (usedColumnIds.has(col.columnId)) continue
    // Only split on columns with 2+ distinct values in this subset
    const valuesInSubset = [
      ...new Set(rows.map((r) => r.answers[col.columnId]).filter(Boolean)),
    ]
    if (valuesInSubset.length < 2) continue

    const candidate = findBestSplitForColumn(rows, col.columnId, valuesInSubset)
    if (candidate && (!bestSplit || candidate.gain > bestSplit.gain)) {
      bestSplit = candidate
    }
  }

  // No useful split found — leaf
  if (!bestSplit || bestSplit.gain < 0.001) {
    return {
      depth,
      leaf: {
        totalCount: rows.length,
        buyerCount,
        conversionRate,
        respondentIds: rows.map((r) => r.respondentId),
      },
    }
  }

  // Recurse
  const newUsed = new Set(usedColumnIds)
  newUsed.add(bestSplit.columnId)

  return {
    depth,
    split: {
      columnId: bestSplit.columnId,
      splitValues: bestSplit.splitValues,
      gain: bestSplit.gain,
    },
    yesBranch: buildTreeNode(bestSplit.yesRows, columns, newUsed, depth + 1, config),
    noBranch: buildTreeNode(bestSplit.noRows, columns, newUsed, depth + 1, config),
  }
}

/**
 * Build a CART decision tree from respondent data.
 *
 * @param rows - All respondents with their answers and buyer flag
 * @param columns - Column metadata (which columns to consider for splits)
 * @param config - Tree configuration (max depth, min leaf size, etc.)
 * @returns Root TreeNode
 */
export function buildDecisionTree(
  rows: RespondentRow[],
  columns: ColumnMeta[],
  config: TreeConfig = DEFAULT_TREE_CONFIG
): TreeNode {
  return buildTreeNode(rows, columns, new Set(), 0, config)
}

// ─── Extract Avatar Paths ────────────────────────────────────

function getColumnHeader(columns: ColumnMeta[], columnId: string): string {
  return columns.find((c) => c.columnId === columnId)?.normalizedHeader || columnId
}

/**
 * Walk the tree and extract all root-to-leaf paths where
 * the leaf meets the avatar criteria (min conversion, min buyers).
 */
function collectPaths(
  node: TreeNode,
  columns: ColumnMeta[],
  currentConditions: AvatarCondition[],
  config: TreeConfig
): AvatarPath[] {
  // Leaf node
  if (node.leaf) {
    if (
      node.leaf.conversionRate >= config.minConversionRate &&
      node.leaf.buyerCount >= config.minBuyersInLeaf &&
      node.leaf.totalCount >= config.minLeafSize
    ) {
      return [{ conditions: [...currentConditions], leaf: node.leaf }]
    }
    return []
  }

  const paths: AvatarPath[] = []

  if (node.split && node.yesBranch) {
    const yesCondition: AvatarCondition = {
      columnId: node.split.columnId,
      header: getColumnHeader(columns, node.split.columnId),
      operator: 'in',
      values: node.split.splitValues,
    }
    paths.push(
      ...collectPaths(node.yesBranch, columns, [...currentConditions, yesCondition], config)
    )
  }

  if (node.split && node.noBranch) {
    const noCondition: AvatarCondition = {
      columnId: node.split.columnId,
      header: getColumnHeader(columns, node.split.columnId),
      operator: 'not_in',
      values: node.split.splitValues,
    }
    paths.push(
      ...collectPaths(node.noBranch, columns, [...currentConditions, noCondition], config)
    )
  }

  return paths
}

/**
 * Extract avatar candidates from a built tree.
 * Returns paths sorted by conversion rate (desc), capped at maxAvatars.
 * Deduplicates: if two paths share >80% of the same buyers, keep only the better one.
 */
export function extractAvatarPaths(
  root: TreeNode,
  columns: ColumnMeta[],
  config: TreeConfig = DEFAULT_TREE_CONFIG
): AvatarPath[] {
  const allPaths = collectPaths(root, columns, [], config)

  // Sort by: conversion rate desc, then buyer count desc
  allPaths.sort((a, b) => {
    const rateDiff = b.leaf.conversionRate - a.leaf.conversionRate
    if (Math.abs(rateDiff) > 0.01) return rateDiff
    return b.leaf.buyerCount - a.leaf.buyerCount
  })

  // Deduplicate: remove paths with >80% buyer overlap
  const selected: AvatarPath[] = []
  for (const path of allPaths) {
    if (selected.length >= config.maxAvatars) break

    const pathBuyerIds = new Set(
      path.leaf.respondentIds.filter((id) => {
        // We need to check if this respondent is a buyer
        // Since leaf already has buyerCount, we use respondentIds
        // The overlap check is approximate — good enough for dedup
        return true
      })
    )

    const hasHighOverlap = selected.some((existing) => {
      const existingIds = new Set(existing.leaf.respondentIds)
      const overlap = path.leaf.respondentIds.filter((id) => existingIds.has(id)).length
      const minSize = Math.min(path.leaf.respondentIds.length, existing.leaf.respondentIds.length)
      return minSize > 0 && overlap / minSize > 0.8
    })

    if (!hasHighOverlap) {
      selected.push(path)
    }
  }

  return selected
}

/**
 * Classify a single respondent through the tree.
 * Returns the leaf node they end up in.
 */
export function classifyRespondent(
  node: TreeNode,
  answers: Record<string, string>
): TreeLeaf | null {
  if (node.leaf) return node.leaf

  if (!node.split) return null

  const value = answers[node.split.columnId]
  const goesYes = value != null && node.split.splitValues.includes(value)

  if (goesYes && node.yesBranch) {
    return classifyRespondent(node.yesBranch, answers)
  } else if (node.noBranch) {
    return classifyRespondent(node.noBranch, answers)
  }

  return null
}

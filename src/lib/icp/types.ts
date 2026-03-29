/**
 * ICP Engine — Shared Types
 *
 * Zero dependencies. These types define the contract between
 * the decision tree, profile generator, and scorer modules.
 *
 * Architecture: all modules are pure functions that receive
 * data as plain objects — no DB clients, no framework imports.
 */

// ─── Input Data ──────────────────────────────────────────────

/** A single respondent's closed answers, flattened to column→value */
export interface RespondentRow {
  respondentId: string
  isBuyer: boolean
  /** Map of columnId → answer value (string) */
  answers: Record<string, string>
}

/** Metadata about a column used in the tree / scoring */
export interface ColumnMeta {
  columnId: string
  header: string
  normalizedHeader: string
  columnType: string
  semanticCategory: string | null
  /** Distinct values seen across all respondents */
  distinctValues: string[]
}

// ─── Decision Tree ───────────────────────────────────────────

export interface TreeSplit {
  columnId: string
  /** Values that go to the "yes" branch */
  splitValues: string[]
  /** Information gain or gini reduction achieved */
  gain: number
}

export interface TreeLeaf {
  totalCount: number
  buyerCount: number
  /** buyerCount / totalCount */
  conversionRate: number
  /** IDs of respondents in this leaf */
  respondentIds: string[]
}

export interface TreeNode {
  split?: TreeSplit
  /** Present only on leaf nodes */
  leaf?: TreeLeaf
  /** Child when split condition is TRUE (value in splitValues) */
  yesBranch?: TreeNode
  /** Child when split condition is FALSE */
  noBranch?: TreeNode
  /** Depth of this node in the tree */
  depth: number
}

/** A path from root to a high-conversion leaf = one avatar */
export interface AvatarPath {
  /** Ordered list of conditions from root to leaf */
  conditions: AvatarCondition[]
  leaf: TreeLeaf
}

export interface AvatarCondition {
  columnId: string
  header: string
  /** "in" = value must be in the set, "not_in" = value must NOT be in the set */
  operator: 'in' | 'not_in'
  values: string[]
}

// ─── ICP Profile / Avatar ────────────────────────────────────

export type RuleType = 'must_match' | 'prefer' | 'strong_signal'

export interface ClosedRule {
  columnId: string
  header: string
  semanticCategory: string | null
  matchValues: string[]
  weight: number
  type: RuleType
  /** % of buyers in this avatar that gave one of matchValues */
  buyerPercentage: number
}

export interface AvatarProfile {
  /** 1-indexed: Avatar 1, Avatar 2, etc. */
  index: number
  /** Auto-generated label, user can rename */
  label: string
  /** Description of the avatar's key traits */
  description: string
  /** Rules for scoring */
  closedRules: ClosedRule[]
  /** Conversion probability: buyers matching / total matching */
  conversionProbability: number
  /** How many buyers are in this avatar */
  buyerCount: number
  /** How many total respondents match this avatar */
  totalMatchCount: number
  /** % of all buyers covered by this avatar */
  buyerCoverage: number
  /** Conditions from the decision tree that define this avatar */
  treeConditions: AvatarCondition[]
}

export interface ICPGenerationResult {
  avatars: AvatarProfile[]
  /** Total buyers analyzed */
  totalBuyers: number
  /** Total respondents analyzed */
  totalRespondents: number
  /** % of buyers covered by at least one avatar */
  totalBuyerCoverage: number
  /** Columns used in the analysis */
  columnsUsed: ColumnMeta[]
  generatedAt: string
}

// ─── Scoring ─────────────────────────────────────────────────

export interface RuleMatch {
  columnId: string
  header: string
  rule: ClosedRule
  matched: boolean
  respondentValue: string | null
}

export interface AvatarScoreResult {
  avatarIndex: number
  avatarLabel: string
  /** 0-100 */
  score: number
  /** Was capped due to must_match failure? */
  wasCapped: boolean
  conversionProbability: number
  ruleMatches: RuleMatch[]
}

export interface RespondentScoreResult {
  respondentId: string
  /** Best score across all avatars */
  bestScore: number
  /** Which avatar gave the best score */
  bestAvatarIndex: number
  bestAvatarLabel: string
  /** Conversion probability of the best-matching avatar */
  conversionProbability: number
  /** Score per avatar */
  avatarScores: AvatarScoreResult[]
}

// ─── Configuration ───────────────────────────────────────────

export interface TreeConfig {
  /** Max depth of the tree (default: 3) */
  maxDepth: number
  /** Min samples in a leaf to consider it valid (default: 5) */
  minLeafSize: number
  /** Min conversion rate to consider a leaf as an avatar (default: 0.3 = 30%) */
  minConversionRate: number
  /** Max number of avatars to generate (default: 3) */
  maxAvatars: number
  /** Min buyers in a leaf to be an avatar candidate (default: 3) */
  minBuyersInLeaf: number
}

export const DEFAULT_TREE_CONFIG: TreeConfig = {
  maxDepth: 3,
  minLeafSize: 5,
  minConversionRate: 0.3,
  maxAvatars: 3,
  minBuyersInLeaf: 3,
}

export interface ScoringWeights {
  qualification: number
  revenue_current: number
  revenue_desired: number
  pain_challenge: number
  desire_goal: number
  purchase_intent: number
  purchase_decision: number
  purchase_objection: number
  experience_time: number
  investment_willingness: number
  /** Default weight for categories not listed above */
  default: number
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  qualification: 5,
  revenue_current: 3,
  revenue_desired: 2,
  pain_challenge: 2,
  desire_goal: 2,
  purchase_intent: 5,
  purchase_decision: 4,
  purchase_objection: 3,
  experience_time: 1,
  investment_willingness: 4,
  default: 2,
}

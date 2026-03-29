/**
 * ICP Engine — Public API
 *
 * All exports from this barrel are pure functions.
 * The only module that touches the database is the API routes
 * that call these functions.
 */

export { buildDecisionTree, extractAvatarPaths, classifyRespondent } from './decision-tree'
export { generateICPProfiles } from './profile-generator'
export { scoreRespondent, scoreBatch, scoreAgainstAvatar, getScoreBadge } from './scorer'
export { DEFAULT_TREE_CONFIG, DEFAULT_SCORING_WEIGHTS } from './types'
export type {
  RespondentRow,
  ColumnMeta,
  TreeConfig,
  ScoringWeights,
  AvatarProfile,
  ICPGenerationResult,
  RespondentScoreResult,
  AvatarScoreResult,
  ClosedRule,
  RuleMatch,
} from './types'

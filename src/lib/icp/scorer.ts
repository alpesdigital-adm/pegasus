/**
 * ICP Engine — Scorer
 *
 * Pure function: receives avatar profiles + respondent answers,
 * returns scores. No DB dependency.
 *
 * Scoring formula per avatar:
 *   score = Σ(weight × matchResult) / Σ(maxPossibleWeight) × 100
 *
 * Rule types:
 *   must_match → match=1 if value in matchValues, 0 otherwise.
 *                If ANY must_match fails, total score capped at 30.
 *   prefer    → match=1 if exact match, 0 otherwise.
 *   strong_signal → match=1 if exact match, 0 otherwise.
 *
 * Final score = max(score across all avatars).
 */

import type {
  AvatarProfile,
  AvatarScoreResult,
  RespondentScoreResult,
  RuleMatch,
} from './types'

const MUST_MATCH_CAP = 30

/**
 * Score a single respondent against a single avatar.
 */
export function scoreAgainstAvatar(
  answers: Record<string, string>,
  avatar: AvatarProfile
): AvatarScoreResult {
  const ruleMatches: RuleMatch[] = []
  let totalWeight = 0
  let matchedWeight = 0
  let hasMustMatchFailure = false

  for (const rule of avatar.closedRules) {
    const respondentValue = answers[rule.columnId] ?? null
    const matched =
      respondentValue != null && rule.matchValues.includes(respondentValue)

    ruleMatches.push({
      columnId: rule.columnId,
      header: rule.header,
      rule,
      matched,
      respondentValue,
    })

    totalWeight += rule.weight

    if (matched) {
      matchedWeight += rule.weight
    } else if (rule.type === 'must_match') {
      hasMustMatchFailure = true
    }
  }

  let score = totalWeight > 0 ? (matchedWeight / totalWeight) * 100 : 0

  if (hasMustMatchFailure && score > MUST_MATCH_CAP) {
    score = MUST_MATCH_CAP
  }

  // Round to 1 decimal
  score = Math.round(score * 10) / 10

  return {
    avatarIndex: avatar.index,
    avatarLabel: avatar.label,
    score,
    wasCapped: hasMustMatchFailure && matchedWeight / totalWeight * 100 > MUST_MATCH_CAP,
    conversionProbability: avatar.conversionProbability,
    ruleMatches,
  }
}

/**
 * Score a single respondent against all avatars.
 * Returns the best score and full breakdown per avatar.
 */
export function scoreRespondent(
  respondentId: string,
  answers: Record<string, string>,
  avatars: AvatarProfile[]
): RespondentScoreResult {
  if (avatars.length === 0) {
    return {
      respondentId,
      bestScore: 0,
      bestAvatarIndex: 0,
      bestAvatarLabel: '',
      conversionProbability: 0,
      avatarScores: [],
    }
  }

  const avatarScores = avatars.map((avatar) =>
    scoreAgainstAvatar(answers, avatar)
  )

  // Find best score
  let best = avatarScores[0]
  for (const as of avatarScores) {
    if (as.score > best.score) {
      best = as
    }
  }

  return {
    respondentId,
    bestScore: best.score,
    bestAvatarIndex: best.avatarIndex,
    bestAvatarLabel: best.avatarLabel,
    conversionProbability: best.conversionProbability,
    avatarScores,
  }
}

/**
 * Score multiple respondents in batch.
 * Returns array of results + summary stats.
 */
export function scoreBatch(
  respondents: { respondentId: string; answers: Record<string, string> }[],
  avatars: AvatarProfile[]
): {
  results: RespondentScoreResult[]
  stats: {
    avgScore: number
    medianScore: number
    distribution: { range: string; count: number; percentage: number }[]
    aboveThreshold: { threshold: number; count: number; percentage: number }[]
  }
} {
  const results = respondents.map((r) =>
    scoreRespondent(r.respondentId, r.answers, avatars)
  )

  const scores = results.map((r) => r.bestScore).sort((a, b) => a - b)
  const total = scores.length

  const avgScore =
    total > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / total) * 10) / 10 : 0

  const medianScore =
    total > 0
      ? total % 2 === 0
        ? (scores[total / 2 - 1] + scores[total / 2]) / 2
        : scores[Math.floor(total / 2)]
      : 0

  // Distribution in 5 ranges
  const ranges = [
    { range: '0-20', min: 0, max: 20 },
    { range: '21-40', min: 21, max: 40 },
    { range: '41-60', min: 41, max: 60 },
    { range: '61-80', min: 61, max: 80 },
    { range: '81-100', min: 81, max: 100 },
  ]

  const distribution = ranges.map((r) => {
    const count = scores.filter((s) => s >= r.min && s <= r.max).length
    return {
      range: r.range,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }
  })

  // Useful thresholds
  const thresholds = [40, 60, 70, 80]
  const aboveThreshold = thresholds.map((t) => {
    const count = scores.filter((s) => s >= t).length
    return {
      threshold: t,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }
  })

  return { results, stats: { avgScore, medianScore, distribution, aboveThreshold } }
}

/**
 * Get the color/badge for a score.
 */
export function getScoreBadge(score: number): {
  color: 'green' | 'yellow' | 'red' | 'gray'
  label: string
} {
  if (score >= 70) return { color: 'green', label: 'Quente' }
  if (score >= 40) return { color: 'yellow', label: 'Morno' }
  if (score > 0) return { color: 'red', label: 'Frio' }
  return { color: 'gray', label: 'Sem score' }
}

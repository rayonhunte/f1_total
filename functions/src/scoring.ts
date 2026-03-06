import type { PickDoc, PickScoreBreakdown, RaceResultDoc, ScoringRules } from './types'

export const DEFAULT_SCORING_RULES: ScoringRules = {
  podiumPoints: {
    p1: 25,
    p2: 18,
    p3: 15,
  },
  constructorPointsMode: 'official',
  constructorPointsCustom: {},
  constructorPointsMultiplier: 1,
  standingsMovement: {
    constructorGain: 2,
    driverGain: 1,
  },
  dnfPenalty: {
    enabled: false,
    value: 0,
  },
  captainMultiplier: 1.5,
  wildcardMultiplier: 2,
  budgetMode: {
    enabled: false,
    cap: 100,
    requireSingleConstructor: true,
  },
}

export function mergeScoringRules(partial?: Partial<ScoringRules>): ScoringRules {
  const defaultBudgetMode = DEFAULT_SCORING_RULES.budgetMode ?? {
    enabled: false,
    cap: 100,
    requireSingleConstructor: true,
  }

  return {
    ...DEFAULT_SCORING_RULES,
    ...partial,
    podiumPoints: {
      ...DEFAULT_SCORING_RULES.podiumPoints,
      ...(partial?.podiumPoints ?? {}),
    },
    standingsMovement: {
      ...DEFAULT_SCORING_RULES.standingsMovement,
      ...(partial?.standingsMovement ?? {}),
    },
    dnfPenalty: {
      ...DEFAULT_SCORING_RULES.dnfPenalty,
      ...(partial?.dnfPenalty ?? {}),
    },
    budgetMode: {
      enabled: partial?.budgetMode?.enabled ?? defaultBudgetMode.enabled,
      cap: partial?.budgetMode?.cap ?? defaultBudgetMode.cap,
      requireSingleConstructor:
        partial?.budgetMode?.requireSingleConstructor ?? defaultBudgetMode.requireSingleConstructor,
    },
    constructorPointsCustom: partial?.constructorPointsCustom ?? {},
  }
}

export function calculatePickScoreBreakdown(
  pick: PickDoc,
  result: RaceResultDoc,
  rules: ScoringRules,
  applyWildcard: boolean,
): PickScoreBreakdown {
  let points = 0
  const driverPointMap = new Map<string, number>()

  function addDriverPoints(driverId: string, value: number) {
    driverPointMap.set(driverId, (driverPointMap.get(driverId) ?? 0) + value)
  }

  if (pick.podium.p1 === result.podium[0]) {
    points += rules.podiumPoints.p1
    addDriverPoints(pick.podium.p1, rules.podiumPoints.p1)
  }
  if (pick.podium.p2 === result.podium[1]) {
    points += rules.podiumPoints.p2
    addDriverPoints(pick.podium.p2, rules.podiumPoints.p2)
  }
  if (pick.podium.p3 === result.podium[2]) {
    points += rules.podiumPoints.p3
    addDriverPoints(pick.podium.p3, rules.podiumPoints.p3)
  }

  for (const constructorId of pick.constructors ?? []) {
    const constructorBase =
      rules.constructorPointsMode === 'official'
        ? result.constructorRacePoints[constructorId] ?? 0
        : rules.constructorPointsCustom?.[constructorId] ?? 0

    points += constructorBase * (rules.constructorPointsMultiplier ?? 1)

    const movementGain = Math.max(0, result.constructorMovement[constructorId] ?? 0)
    points += movementGain * rules.standingsMovement.constructorGain
  }

  const selectedDrivers = [pick.podium.p1, pick.podium.p2, pick.podium.p3]

  for (const driverId of selectedDrivers) {
    const movementGain = Math.max(0, result.driverMovement[driverId] ?? 0)
    const movementPoints = movementGain * rules.standingsMovement.driverGain
    points += movementPoints
    addDriverPoints(driverId, movementPoints)
  }

  if (rules.dnfPenalty.enabled && rules.dnfPenalty.value > 0) {
    const dnfMap = new Map(result.driverResults.map((item) => [item.driverId, item.dnf]))

    for (const driverId of selectedDrivers) {
      if (dnfMap.get(driverId)) {
        points -= rules.dnfPenalty.value
        addDriverPoints(driverId, -rules.dnfPenalty.value)
      }
    }
  }

  const captainMultiplier = Math.max(1, rules.captainMultiplier ?? 1.5)
  const captainDriverId = pick.captainDriverId
  const captainBase = captainDriverId ? driverPointMap.get(captainDriverId) ?? 0 : 0
  const captainBonus = captainBase > 0 ? captainBase * (captainMultiplier - 1) : 0

  const basePlusCaptain = points + captainBonus
  const wildcardMultiplier = Math.max(1, rules.wildcardMultiplier ?? 2)
  const wildcardBonus = applyWildcard ? basePlusCaptain * (wildcardMultiplier - 1) : 0
  const totalPoints = basePlusCaptain + wildcardBonus

  return {
    basePoints: Math.round(points),
    captainBonus: Math.round(captainBonus),
    wildcardBonus: Math.round(wildcardBonus),
    totalPoints: Math.round(totalPoints),
  }
}

export function calculatePickScore(pick: PickDoc, result: RaceResultDoc, rules: ScoringRules): number {
  return calculatePickScoreBreakdown(pick, result, rules, false).totalPoints
}

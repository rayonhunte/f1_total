import type { PickDoc, RaceResultDoc, ScoringRules } from './types'

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
}

export function mergeScoringRules(partial?: Partial<ScoringRules>): ScoringRules {
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
    constructorPointsCustom: partial?.constructorPointsCustom ?? {},
  }
}

export function calculatePickScore(pick: PickDoc, result: RaceResultDoc, rules: ScoringRules): number {
  let points = 0

  if (pick.podium.p1 === result.podium[0]) points += rules.podiumPoints.p1
  if (pick.podium.p2 === result.podium[1]) points += rules.podiumPoints.p2
  if (pick.podium.p3 === result.podium[2]) points += rules.podiumPoints.p3

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
    points += movementGain * rules.standingsMovement.driverGain
  }

  if (rules.dnfPenalty.enabled && rules.dnfPenalty.value > 0) {
    const dnfMap = new Map(result.driverResults.map((item) => [item.driverId, item.dnf]))

    for (const driverId of selectedDrivers) {
      if (dnfMap.get(driverId)) {
        points -= rules.dnfPenalty.value
      }
    }
  }

  return Math.round(points)
}

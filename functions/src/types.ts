export type LockMode = 'FP3_END' | 'QUALIFYING_END' | 'RACE_START' | 'CUSTOM_DATETIME'

export type ScoringRules = {
  podiumPoints: {
    p1: number
    p2: number
    p3: number
  }
  constructorPointsMode: 'official' | 'custom'
  constructorPointsCustom?: Record<string, number>
  constructorPointsMultiplier?: number
  standingsMovement: {
    constructorGain: number
    driverGain: number
  }
  dnfPenalty: {
    enabled: boolean
    value: number
  }
  captainMultiplier?: number
  wildcardMultiplier?: number
  budgetMode?: {
    enabled: boolean
    cap: number
    requireSingleConstructor: boolean
  }
}

export type SeasonDoc = {
  name: string
  year: number
  isActive: boolean
  scoringRules?: Partial<ScoringRules>
  lockPolicy?: {
    mode: LockMode
    customDateTime?: string
  }
}

export type RaceDoc = {
  seasonId: string
  seasonYear: number
  round: number
  name: string
  raceStartAt?: string
  lockAt?: string
  status?: 'scheduled' | 'in_progress' | 'completed' | 'results_ingested'
}

export type PickDoc = {
  uid: string
  groupId: string
  seasonId: string
  raceId: string
  podium: {
    p1: string
    p2: string
    p3: string
  }
  constructors: string[]
  captainDriverId?: string
  wildcard?: boolean
  budgetCost?: number
}

export type DriverResult = {
  driverId: string
  code: string
  constructorId: string
  position: number
  points: number
  status: string
  dnf: boolean
}

export type RaceResultDoc = {
  seasonId: string
  raceId: string
  seasonYear: number
  round: number
  raceName: string
  podium: [string, string, string]
  driverResults: DriverResult[]
  constructorRacePoints: Record<string, number>
  driverMovement: Record<string, number>
  constructorMovement: Record<string, number>
  ingestedAt: string
}

export type ScoreDoc = {
  uid: string
  groupId: string
  seasonId: string
  totalPoints: number
  byRace: Record<string, number>
  detailByRace?: Record<
    string,
    {
      basePoints: number
      captainBonus: number
      wildcardBonus: number
      totalPoints: number
    }
  >
  wildcardRaceId?: string
  lastUpdatedAt: string
}

export type PickScoreBreakdown = {
  basePoints: number
  captainBonus: number
  wildcardBonus: number
  totalPoints: number
}

export type WeeklyRecap = {
  seasonId: string
  groupId: string
  raceId: string
  biggestMover: { uid: string; displayName: string; rankDelta: number } | null
  bestPick: { uid: string; displayName: string; pointsDelta: number } | null
  worstMiss: { uid: string; displayName: string; pointsDelta: number } | null
  closestPodiumGuess: { uid: string; displayName: string; matches: number } | null
}

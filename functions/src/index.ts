import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import tzLookup from 'tz-lookup'
import {
  fetchConstructorStandings,
  fetchDriverStandings,
  fetchRaceResults,
  fetchSeasonSchedule,
  fetchSeasonConstructors,
  fetchSeasonDrivers,
  isDnfStatus,
} from './jolpi'
import { calculatePickScoreBreakdown, mergeScoringRules } from './scoring'
import type {
  PickDoc,
  RaceDoc,
  RaceResultDoc,
  ScoreDoc,
  ScoringRules,
  SeasonDoc,
  WeeklyRecap,
} from './types'

initializeApp()
const db = getFirestore()

type SyncRequest = {
  seasonId?: string
  raceId?: string
}

type GroupSyncRequest = {
  seasonId?: string
  raceId?: string
  groupId?: string
}

type InitializeSeasonRequest = {
  seasonId?: string
  seasonName?: string
  seasonYear?: number
  activateSeason?: boolean
  firstRaceName?: string
  firstRaceRound?: number
  raceStartAt?: string
  lockAt?: string
  circuitTimezone?: string
  seedDefaultRoster?: boolean
}

type ImportSeasonScheduleRequest = {
  seasonId?: string
  seasonYear?: number
}

type SyncSeasonTimezonesRequest = {
  seasonId?: string
  dryRun?: boolean
  force?: boolean
}

type SyncSeasonTimezonesResponse = {
  seasonId: string
  seasonYear: number
  totalFromApi: number
  updated: number
  skipped: number
  races: Array<{
    raceId: string
    raceName: string
    round: number
    circuitTimezone?: string
    raceStartAt?: string
    lockAt?: string
  }>
}

type ImportSeasonScheduleResponse = {
  seasonId: string
  seasonYear: number
  totalFromApi: number
  created: number
  updated: number
  skippedCompleted: number
}

type LiveRosterRequest = {
  seasonId?: string
  seasonYear?: number
}

type GetStatsBootstrapRequest = {
  seasonId?: string
}

type StatsBootstrapRaceInfo = {
  id: string
  name: string
  round: number
}

type StatsBootstrapResultDriverRow = {
  driverId: string
  constructorId: string
  points: number
  status: string
  dnf: boolean
}

type StatsBootstrapResponse = {
  source: {
    schedule: 'jolpi' | 'firestore'
    drivers: 'jolpi' | 'firestore'
    constructors: 'jolpi' | 'firestore'
    results: 'firestore'
  }
  seasonId: string
  seasonName: string
  seasonYear: number
  races: StatsBootstrapRaceInfo[]
  results: Array<{
    raceId: string
    round: number
    raceName?: string
    podium: [string, string, string]
    driverResults: StatsBootstrapResultDriverRow[]
    driverMovement?: Record<string, number>
  }>
  drivers: Array<{ id: string; name: string }>
  constructors: Array<{ id: string; name: string }>
  scoringRules: {
    podiumPoints: { p1: number; p2: number; p3: number }
    driverGain: number
    dnfPenalty: { enabled: boolean; value: number }
  }
}

type UpdateRaceCircuitTimezoneRequest = {
  raceId: string
  circuitTimezone: string
}

type UpdateSeasonScoringRulesRequest = {
  seasonId?: string
  scoringRules?: Partial<ScoringRules>
}

type SimulateScoringRequest = {
  seasonId?: string
  scoringRules?: Partial<ScoringRules>
}

type GetWeeklyRecapRequest = {
  seasonId?: string
  groupId?: string
  raceId?: string
}

type NotificationPreferenceRequest = {
  emailEnabled?: boolean
  pushEnabled?: boolean
  lockReminderMinutesBefore?: number
}

type GetSeasonAwardsRequest = {
  seasonId?: string
  groupId?: string
}

type RequestGroupAccessRequest = {
  groupId?: string
  joinCode?: string
}

type RequestGroupAccessResponse = {
  groupId: string
  status: 'active' | 'pending'
}

type GroupSyncResponse = {
  seasonId: string
  raceId: string
  groupId: string
  scoredPicks: number
}

type GetMyGroupsResponse = {
  groups: Array<{
    id: string
    name: string
    joinCode: string
    role: 'owner' | 'admin' | 'member'
    status: 'active' | 'pending'
  }>
}

type GetJoinableGroupsResponse = {
  groups: Array<{
    id: string
    name: string
  }>
}
type ConstructorSeed = {
  id: string
  name: string
}

type DriverSeed = {
  id: string
  name: string
  code: string
}

const defaultConstructors: ConstructorSeed[] = [
  { id: 'red_bull', name: 'Red Bull' },
  { id: 'mercedes', name: 'Mercedes' },
  { id: 'ferrari', name: 'Ferrari' },
  { id: 'mclaren', name: 'McLaren' },
  { id: 'aston_martin', name: 'Aston Martin' },
  { id: 'alpine', name: 'Alpine' },
  { id: 'williams', name: 'Williams' },
  { id: 'haas', name: 'Haas F1 Team' },
  { id: 'rb', name: 'Racing Bulls' },
  { id: 'sauber', name: 'Sauber' },
]

const defaultDrivers: DriverSeed[] = [
  { id: 'max_verstappen', name: 'Max Verstappen', code: 'VER' },
  { id: 'perez', name: 'Sergio Perez', code: 'PER' },
  { id: 'hamilton', name: 'Lewis Hamilton', code: 'HAM' },
  { id: 'russell', name: 'George Russell', code: 'RUS' },
  { id: 'leclerc', name: 'Charles Leclerc', code: 'LEC' },
  { id: 'sainz', name: 'Carlos Sainz', code: 'SAI' },
  { id: 'norris', name: 'Lando Norris', code: 'NOR' },
  { id: 'piastri', name: 'Oscar Piastri', code: 'PIA' },
  { id: 'alonso', name: 'Fernando Alonso', code: 'ALO' },
  { id: 'stroll', name: 'Lance Stroll', code: 'STR' },
  { id: 'gasly', name: 'Pierre Gasly', code: 'GAS' },
  { id: 'ocon', name: 'Esteban Ocon', code: 'OCO' },
  { id: 'albon', name: 'Alex Albon', code: 'ALB' },
  { id: 'sargeant', name: 'Logan Sargeant', code: 'SAR' },
  { id: 'hulkenberg', name: 'Nico Hulkenberg', code: 'HUL' },
  { id: 'magnussen', name: 'Kevin Magnussen', code: 'MAG' },
  { id: 'tsunoda', name: 'Yuki Tsunoda', code: 'TSU' },
  { id: 'ricciardo', name: 'Daniel Ricciardo', code: 'RIC' },
  { id: 'bottas', name: 'Valtteri Bottas', code: 'BOT' },
  { id: 'zhou', name: 'Zhou Guanyu', code: 'ZHO' },
]

function timestampToDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (value instanceof Timestamp) return value.toDate()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function normalizeSeasonId(rawId: string | undefined, year: number): string {
  const fallback = String(year)
  const source = (rawId ?? fallback).trim().toLowerCase()
  const normalized = source.replace(/[^a-z0-9_-]/g, '_')
  return normalized || fallback
}

function parseRequiredIsoDate(value: string | undefined, fieldLabel: string): Date {
  if (!value?.trim()) {
    throw new HttpsError('invalid-argument', `${fieldLabel} is required.`)
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpsError('invalid-argument', `${fieldLabel} must be a valid ISO datetime.`)
  }

  return parsed
}

function parseNonNegativeNumber(value: unknown, fieldLabel: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpsError('invalid-argument', `${fieldLabel} must be a non-negative number.`)
  }
  return parsed
}

async function assertSeasonSetupAccess(uid: string, isAdmin: boolean): Promise<void> {
  if (isAdmin) return

  const ownedGroupsSnapshot = await db.collection('groups').where('ownerUid', '==', uid).limit(1).get()
  if (ownedGroupsSnapshot.empty) {
    throw new HttpsError('permission-denied', 'Only group owners or platform admins can initialize seasons.')
  }
}

function resolveRaceStatusForImport(raceStartAt: Date | null, hasResults: boolean): RaceDoc['status'] {
  if (hasResults) return 'completed'
  if (raceStartAt && raceStartAt <= new Date()) return 'in_progress'
  return 'scheduled'
}

function parseScoringRulesInput(raw: unknown): ScoringRules {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpsError('invalid-argument', 'scoringRules must be an object.')
  }

  const input = raw as Record<string, unknown>
  const podiumInput =
    input.podiumPoints && typeof input.podiumPoints === 'object' && !Array.isArray(input.podiumPoints)
      ? (input.podiumPoints as Record<string, unknown>)
      : {}

  const standingsInput =
    input.standingsMovement &&
    typeof input.standingsMovement === 'object' &&
    !Array.isArray(input.standingsMovement)
      ? (input.standingsMovement as Record<string, unknown>)
      : {}

  const dnfInput =
    input.dnfPenalty && typeof input.dnfPenalty === 'object' && !Array.isArray(input.dnfPenalty)
      ? (input.dnfPenalty as Record<string, unknown>)
      : {}

  const budgetInput =
    input.budgetMode && typeof input.budgetMode === 'object' && !Array.isArray(input.budgetMode)
      ? (input.budgetMode as Record<string, unknown>)
      : {}

  const constructorMode = input.constructorPointsMode
  if (constructorMode !== 'official' && constructorMode !== 'custom') {
    throw new HttpsError(
      'invalid-argument',
      'scoringRules.constructorPointsMode must be "official" or "custom".',
    )
  }

  const customRaw = input.constructorPointsCustom
  if (customRaw != null && (typeof customRaw !== 'object' || Array.isArray(customRaw))) {
    throw new HttpsError('invalid-argument', 'scoringRules.constructorPointsCustom must be an object.')
  }

  const constructorPointsCustomEntries = Object.entries(
    (customRaw as Record<string, unknown>) ?? {},
  ).reduce<Record<string, number>>((acc, [constructorId, rawValue]) => {
    if (!constructorId.trim()) return acc
    acc[constructorId] = parseNonNegativeNumber(
      rawValue,
      `scoringRules.constructorPointsCustom.${constructorId}`,
    )
    return acc
  }, {})

  return mergeScoringRules({
    podiumPoints: {
      p1: parseNonNegativeNumber(podiumInput.p1 ?? 25, 'scoringRules.podiumPoints.p1'),
      p2: parseNonNegativeNumber(podiumInput.p2 ?? 18, 'scoringRules.podiumPoints.p2'),
      p3: parseNonNegativeNumber(podiumInput.p3 ?? 15, 'scoringRules.podiumPoints.p3'),
    },
    constructorPointsMode: constructorMode,
    constructorPointsMultiplier: parseNonNegativeNumber(
      input.constructorPointsMultiplier ?? 1,
      'scoringRules.constructorPointsMultiplier',
    ),
    constructorPointsCustom: constructorPointsCustomEntries,
    standingsMovement: {
      constructorGain: parseNonNegativeNumber(
        standingsInput.constructorGain ?? 2,
        'scoringRules.standingsMovement.constructorGain',
      ),
      driverGain: parseNonNegativeNumber(
        standingsInput.driverGain ?? 1,
        'scoringRules.standingsMovement.driverGain',
      ),
    },
    dnfPenalty: {
      enabled: dnfInput.enabled === true,
      value: parseNonNegativeNumber(dnfInput.value ?? 0, 'scoringRules.dnfPenalty.value'),
    },
    captainMultiplier: parseNonNegativeNumber(
      input.captainMultiplier ?? 1.5,
      'scoringRules.captainMultiplier',
    ),
    wildcardMultiplier: parseNonNegativeNumber(
      input.wildcardMultiplier ?? 2,
      'scoringRules.wildcardMultiplier',
    ),
    budgetMode: {
      enabled: budgetInput.enabled === true,
      cap: parseNonNegativeNumber(budgetInput.cap ?? 100, 'scoringRules.budgetMode.cap'),
      requireSingleConstructor: budgetInput.requireSingleConstructor !== false,
    },
  })
}

async function seedRosterIfNeeded(enabled: boolean): Promise<{ constructorsSeeded: number; driversSeeded: number }> {
  if (!enabled) {
    return { constructorsSeeded: 0, driversSeeded: 0 }
  }

  let constructorsSeeded = 0
  let driversSeeded = 0

  const [constructorsSnapshot, driversSnapshot] = await Promise.all([
    db.collection('constructors').limit(1).get(),
    db.collection('drivers').limit(1).get(),
  ])

  if (constructorsSnapshot.empty) {
    const batch = db.batch()
    for (const constructor of defaultConstructors) {
      batch.set(
        db.collection('constructors').doc(constructor.id),
        {
          name: constructor.name,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      constructorsSeeded += 1
    }
    await batch.commit()
  }

  if (driversSnapshot.empty) {
    const batch = db.batch()
    for (const driver of defaultDrivers) {
      batch.set(
        db.collection('drivers').doc(driver.id),
        {
          name: driver.name,
          code: driver.code,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      driversSeeded += 1
    }
    await batch.commit()
  }

  return { constructorsSeeded, driversSeeded }
}

function toMovementMap<T extends { position: string }>(
  current: T[],
  previous: T[],
  keyOf: (item: T) => string,
): Record<string, number> {
  const previousPos = new Map(previous.map((item) => [keyOf(item), Number(item.position)]))
  const movement: Record<string, number> = {}

  for (const item of current) {
    const key = keyOf(item)
    const curr = Number(item.position)
    const prev = previousPos.get(key)
    movement[key] = prev ? prev - curr : 0
  }

  return movement
}

async function getSeason(seasonId: string): Promise<SeasonDoc> {
  const snapshot = await db.collection('seasons').doc(seasonId).get()

  if (!snapshot.exists) {
    throw new Error(`Season not found: ${seasonId}`)
  }

  return snapshot.data() as SeasonDoc
}

async function findActiveSeasonId(): Promise<string> {
  const snapshot = await db.collection('seasons').where('isActive', '==', true).limit(1).get()

  if (snapshot.empty) {
    throw new Error('No active season found. Set seasons/{seasonId}.isActive = true')
  }

  return snapshot.docs[0].id
}

async function resolveRosterSeasonYear(input: LiveRosterRequest): Promise<number> {
  const explicitYear = Number(input.seasonYear)
  if (Number.isFinite(explicitYear) && explicitYear >= 1950 && explicitYear <= 2100) {
    return explicitYear
  }

  const seasonId = input.seasonId || (await findActiveSeasonId())
  const season = await getSeason(seasonId)
  const seasonYear = Number(season.year)
  if (Number.isFinite(seasonYear) && seasonYear >= 1950 && seasonYear <= 2100) {
    return seasonYear
  }

  return new Date().getUTCFullYear()
}

async function fetchLiveRosterWithFallback(targetSeasonYear: number) {
  const currentYear = new Date().getUTCFullYear()

  async function fetchForYear(year: number) {
    const [drivers, constructors] = await Promise.all([
      fetchSeasonDrivers(year),
      fetchSeasonConstructors(year),
    ])
    return { seasonYear: year, drivers, constructors }
  }

  try {
    const primary = await fetchForYear(targetSeasonYear)
    if (primary.drivers.length > 0 && primary.constructors.length > 0) {
      return primary
    }
  } catch (error) {
    if (targetSeasonYear === currentYear) {
      throw error
    }
  }

  if (targetSeasonYear !== currentYear) {
    const fallback = await fetchForYear(currentYear)
    if (fallback.drivers.length > 0 && fallback.constructors.length > 0) {
      return fallback
    }
  }

  throw new Error('Live roster unavailable from Jolpi API.')
}

async function fetchNamedOptionsFromCollection(
  collectionName: 'drivers' | 'constructors',
): Promise<Array<{ id: string; name: string }>> {
  const snapshot = await db.collection(collectionName).get()
  return snapshot.docs
    .map((item) => ({
      id: item.id,
      name: String(item.data()?.name ?? item.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchStatsRaceList(
  seasonId: string,
  seasonYear: number,
): Promise<{ source: 'jolpi' | 'firestore'; races: StatsBootstrapRaceInfo[] }> {
  try {
    const schedule = await fetchSeasonSchedule(seasonYear)
    if (schedule.length > 0) {
      return {
        source: 'jolpi',
        races: schedule.map((race) => ({
          id: `${seasonId}_r${race.round}`,
          name: race.raceName,
          round: race.round,
        })),
      }
    }
  } catch (error) {
    logger.warn('Failed to fetch Jolpi schedule for stats bootstrap', {
      seasonId,
      seasonYear,
      error: String(error),
    })
  }

  const racesSnapshot = await db.collection('races').where('seasonId', '==', seasonId).get()
  return {
    source: 'firestore',
    races: racesSnapshot.docs
      .map((raceDoc) => {
        const data = raceDoc.data()
        return {
          id: raceDoc.id,
          name: String(data.name ?? raceDoc.id),
          round: Number(data.round ?? 0),
        }
      })
      .sort((a, b) => a.round - b.round),
  }
}

async function fetchStatsDriverOptions(
  seasonYear: number,
): Promise<{ source: 'jolpi' | 'firestore'; drivers: Array<{ id: string; name: string }> }> {
  try {
    const drivers = await fetchSeasonDrivers(seasonYear)
    if (drivers.length > 0) {
      return {
        source: 'jolpi',
        drivers: drivers.map((driver) => ({ id: driver.id, name: driver.name })),
      }
    }
  } catch (error) {
    logger.warn('Failed to fetch Jolpi drivers for stats bootstrap', {
      seasonYear,
      error: String(error),
    })
  }

  return {
    source: 'firestore',
    drivers: await fetchNamedOptionsFromCollection('drivers'),
  }
}

async function fetchStatsConstructorOptions(
  seasonYear: number,
): Promise<{ source: 'jolpi' | 'firestore'; constructors: Array<{ id: string; name: string }> }> {
  try {
    const constructors = await fetchSeasonConstructors(seasonYear)
    if (constructors.length > 0) {
      return {
        source: 'jolpi',
        constructors: constructors.map((constructor) => ({ id: constructor.id, name: constructor.name })),
      }
    }
  } catch (error) {
    logger.warn('Failed to fetch Jolpi constructors for stats bootstrap', {
      seasonYear,
      error: String(error),
    })
  }

  return {
    source: 'firestore',
    constructors: await fetchNamedOptionsFromCollection('constructors'),
  }
}

function resolveCircuitTimezone(latitude?: number, longitude?: number): string | undefined {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined
  try {
    return tzLookup(latitude as number, longitude as number)
  } catch (error) {
    logger.warn('Failed to resolve timezone from lat/long', { latitude, longitude, error: String(error) })
    return undefined
  }
}

async function pickRaceForSync(
  seasonId: string,
  explicitRaceId?: string,
): Promise<{ raceId: string; race: RaceDoc } | null> {
  if (explicitRaceId) {
    const raceDoc = await db.collection('races').doc(explicitRaceId).get()
    if (!raceDoc.exists) throw new Error(`Race not found: ${explicitRaceId}`)
    return { raceId: raceDoc.id, race: raceDoc.data() as RaceDoc }
  }

  const now = new Date()
  const racesSnapshot = await db.collection('races').where('seasonId', '==', seasonId).get()

  const raceItems = racesSnapshot.docs
    .map((doc) => ({ id: doc.id, race: doc.data() as RaceDoc }))
    .filter((item) => {
      const raceDate = timestampToDate(item.race.raceStartAt)
      return !raceDate || raceDate <= now
    })
    .sort((a, b) => {
      if (a.race.seasonYear !== b.race.seasonYear) return b.race.seasonYear - a.race.seasonYear
      return b.race.round - a.race.round
    })

  for (const item of raceItems) {
    const resultDoc = await db.collection('results').doc(item.id).get()
    if (!resultDoc.exists) {
      return { raceId: item.id, race: item.race }
    }
  }

  return null
}

async function syncRaceStatusesForSeason(seasonId: string): Promise<number> {
  const racesSnapshot = await db.collection('races').where('seasonId', '==', seasonId).get()
  if (racesSnapshot.empty) return 0

  const now = new Date()
  let updates = 0

  for (const raceDoc of racesSnapshot.docs) {
    const race = raceDoc.data() as RaceDoc
    const currentStatus = race.status ?? 'scheduled'
    const lockDate = timestampToDate(race.lockAt) ?? timestampToDate(race.raceStartAt)
    const resultSnapshot = await db.collection('results').doc(raceDoc.id).get()
    const hasResults = resultSnapshot.exists

    let nextStatus: RaceDoc['status'] = currentStatus
    if (hasResults) {
      nextStatus = 'completed'
    } else if (lockDate && lockDate <= now) {
      nextStatus = 'in_progress'
    } else {
      nextStatus = 'scheduled'
    }

    if (nextStatus !== currentStatus) {
      await raceDoc.ref.set(
        {
          status: nextStatus,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      updates += 1
    }
  }

  return updates
}

async function ingestRaceResults(seasonId: string, raceId: string, race: RaceDoc): Promise<RaceResultDoc> {
  const seasonYear = race.seasonYear
  const round = race.round

  if (!seasonYear || !round) {
    throw new Error(`Race ${raceId} must include seasonYear and round for external sync`)
  }

  const [raceResult, driverCurrent, constructorCurrent, driverPrevious, constructorPrevious] = await Promise.all([
    fetchRaceResults(seasonYear, round),
    fetchDriverStandings(seasonYear, round),
    fetchConstructorStandings(seasonYear, round),
    round > 1 ? fetchDriverStandings(seasonYear, round - 1) : Promise.resolve([]),
    round > 1 ? fetchConstructorStandings(seasonYear, round - 1) : Promise.resolve([]),
  ])

  if (!raceResult || !raceResult.Results?.length) {
    throw new Error(`No results returned for ${seasonYear} round ${round}`)
  }

  const sortedResults = raceResult.Results
    .map((entry) => ({
      driverId: entry.Driver.driverId,
      code: entry.Driver.code ?? entry.Driver.driverId.toUpperCase().slice(0, 3),
      constructorId: entry.Constructor.constructorId,
      position: Number(entry.position),
      points: Number(entry.points),
      status: entry.status,
      dnf: isDnfStatus(entry.status),
    }))
    .sort((a, b) => a.position - b.position)

  const podium = sortedResults.slice(0, 3).map((item) => item.driverId)

  if (podium.length < 3) {
    throw new Error(`Race ${raceId} does not have enough classified finishers to build podium`)
  }

  const constructorRacePoints: Record<string, number> = {}
  for (const row of sortedResults) {
    constructorRacePoints[row.constructorId] = (constructorRacePoints[row.constructorId] ?? 0) + row.points
  }

  const driverMovement = toMovementMap(driverCurrent, driverPrevious, (item) => item.Driver.driverId)
  const constructorMovement = toMovementMap(
    constructorCurrent,
    constructorPrevious,
    (item) => item.Constructor.constructorId,
  )

  const payload: RaceResultDoc = {
    seasonId,
    raceId,
    seasonYear,
    round,
    raceName: raceResult.raceName ?? race.name,
    podium: [podium[0], podium[1], podium[2]],
    driverResults: sortedResults,
    constructorRacePoints,
    driverMovement,
    constructorMovement,
    ingestedAt: new Date().toISOString(),
  }

  await db.collection('results').doc(raceId).set(payload, { merge: true })
  await db.collection('races').doc(raceId).set(
    {
      status: 'results_ingested',
      lastIngestedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  return payload
}

async function rebuildLeaderboard(seasonId: string, raceId: string, groupId: string): Promise<void> {
  const leaderboardRef = db.collection('leaderboards').doc(`${seasonId}_${groupId}`)
  const previousSnapshot = await leaderboardRef.get()
  const previousEntries = (previousSnapshot.data()?.entries ?? []) as Array<{ uid: string; rank: number }>
  const previousRanks = new Map(previousEntries.map((item) => [item.uid, item.rank]))

  const scoreSnapshot = await db
    .collection('scores')
    .where('seasonId', '==', seasonId)
    .where('groupId', '==', groupId)
    .get()

  const scoreDocs = scoreSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Array<
    ScoreDoc & { id: string }
  >

  scoreDocs.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
    return a.uid.localeCompare(b.uid)
  })

  const groupSnap = await db.collection('groups').doc(groupId).get()
  const groupName = (groupSnap.data()?.name as string | undefined) ?? groupId

  const userRefs = scoreDocs.map((score) => db.collection('users').doc(score.uid))
  const userSnapshots = userRefs.length > 0 ? await db.getAll(...userRefs) : []
  const userDisplayMap = new Map<string, string>()

  for (const userSnap of userSnapshots) {
    const data = userSnap.data()
    if (data) {
      userDisplayMap.set(
        userSnap.id,
        (data.displayName as string | undefined) ?? (data.email as string | undefined) ?? userSnap.id,
      )
    }
  }

  const entries = scoreDocs.map((score, index) => {
    const rank = index + 1
    const previousRank = previousRanks.get(score.uid) ?? rank

    return {
      uid: score.uid,
      displayName: userDisplayMap.get(score.uid) ?? score.uid,
      rank,
      previousRank,
      rankDelta: previousRank - rank,
      points: score.totalPoints,
      pointsDelta: score.byRace?.[raceId] ?? 0,
    }
  })

  await leaderboardRef.set(
    {
      seasonId,
      groupId,
      groupName,
      updatedAt: FieldValue.serverTimestamp(),
      lastRaceId: raceId,
      entries,
    },
    { merge: true },
  )
}

async function createNotification(
  uid: string,
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const notificationRef = db.collection('notifications').doc()
  await notificationRef.set({
    uid,
    type,
    title,
    body,
    data: data ?? {},
    createdAt: FieldValue.serverTimestamp(),
    readAt: null,
  })
}

async function buildWeeklyRecap(seasonId: string, groupId: string, raceId: string): Promise<WeeklyRecap | null> {
  const [leaderboardSnap, resultSnap, picksSnap] = await Promise.all([
    db.collection('leaderboards').doc(`${seasonId}_${groupId}`).get(),
    db.collection('results').doc(raceId).get(),
    db.collection('picks').where('seasonId', '==', seasonId).where('groupId', '==', groupId).where('raceId', '==', raceId).get(),
  ])

  if (!leaderboardSnap.exists || !resultSnap.exists) return null

  const leaderboardData = leaderboardSnap.data() ?? {}
  const entries = Array.isArray(leaderboardData.entries)
    ? (leaderboardData.entries as Array<{
        uid: string
        displayName: string
        rankDelta: number
        pointsDelta: number
      }>)
    : []

  const biggestMover =
    entries.length > 0
      ? entries.slice().sort((a, b) => b.rankDelta - a.rankDelta)[0]
      : null

  const bestPick = entries.length > 0 ? entries.slice().sort((a, b) => b.pointsDelta - a.pointsDelta)[0] : null
  const worstMiss = entries.length > 0 ? entries.slice().sort((a, b) => a.pointsDelta - b.pointsDelta)[0] : null

  const result = resultSnap.data() as RaceResultDoc
  const podium = result.podium

  const closest = picksSnap.docs
    .map((pickDoc) => {
      const pick = pickDoc.data() as PickDoc
      const matches =
        Number(pick.podium.p1 === podium[0]) + Number(pick.podium.p2 === podium[1]) + Number(pick.podium.p3 === podium[2])

      const row = entries.find((entry) => entry.uid === pick.uid)
      return {
        uid: pick.uid,
        displayName: row?.displayName ?? pick.uid,
        matches,
      }
    })
    .sort((a, b) => b.matches - a.matches)

  const recap: WeeklyRecap = {
    seasonId,
    groupId,
    raceId,
    biggestMover: biggestMover
      ? {
          uid: biggestMover.uid,
          displayName: biggestMover.displayName,
          rankDelta: biggestMover.rankDelta,
        }
      : null,
    bestPick: bestPick
      ? {
          uid: bestPick.uid,
          displayName: bestPick.displayName,
          pointsDelta: bestPick.pointsDelta,
        }
      : null,
    worstMiss: worstMiss
      ? {
          uid: worstMiss.uid,
          displayName: worstMiss.displayName,
          pointsDelta: worstMiss.pointsDelta,
        }
      : null,
    closestPodiumGuess: closest[0]
      ? {
          uid: closest[0].uid,
          displayName: closest[0].displayName,
          matches: closest[0].matches,
        }
      : null,
  }

  await db.collection('weeklyRecaps').doc(`${seasonId}_${groupId}_${raceId}`).set(
    {
      ...recap,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  return recap
}

async function notifyScoreUpdates(seasonId: string, groupId: string, raceId: string): Promise<void> {
  const leaderboardSnap = await db.collection('leaderboards').doc(`${seasonId}_${groupId}`).get()
  if (!leaderboardSnap.exists) return

  const entries = (leaderboardSnap.data()?.entries ?? []) as Array<{
    uid: string
    displayName: string
    pointsDelta: number
    rank: number
  }>

  await Promise.all(
    entries.map((entry) =>
      createNotification(
        entry.uid,
        'score_update',
        'Race scored',
        `You earned ${entry.pointsDelta} points in ${raceId}. Current rank: #${entry.rank}.`,
        { seasonId, groupId, raceId, pointsDelta: entry.pointsDelta, rank: entry.rank },
      ),
    ),
  )
}

async function recomputeRaceScores(seasonId: string, raceId: string, result: RaceResultDoc): Promise<number> {
  const season = await getSeason(seasonId)
  const rules = mergeScoringRules(season.scoringRules)

  const picksSnapshot = await db
    .collection('picks')
    .where('seasonId', '==', seasonId)
    .where('raceId', '==', raceId)
    .get()

  const groupIdsTouched = new Set<string>()

  for (const pickDoc of picksSnapshot.docs) {
    const pick = pickDoc.data() as PickDoc
    if (!pick.groupId) continue

    groupIdsTouched.add(pick.groupId)

    const scoreRef = db.collection('scores').doc(`${seasonId}_${pick.groupId}_${pick.uid}`)
    const scoreSnap = await scoreRef.get()
    const existingData = (scoreSnap.data() ?? {}) as ScoreDoc
    const existingWildcardRaceId = existingData.wildcardRaceId

    let applyWildcard = false
    let wildcardRaceId = existingWildcardRaceId

    if (pick.wildcard) {
      if (existingWildcardRaceId) {
        applyWildcard = existingWildcardRaceId === raceId
      } else {
        applyWildcard = true
        wildcardRaceId = raceId
      }
    }

    const breakdown = calculatePickScoreBreakdown(pick, result, rules, applyWildcard)

    const existingByRace = (existingData.byRace ?? {}) as Record<string, number>
    const existingDetailByRace =
      (existingData.detailByRace ?? {}) as Record<
        string,
        {
          basePoints: number
          captainBonus: number
          wildcardBonus: number
          totalPoints: number
        }
      >

    const byRace = {
      ...existingByRace,
      [raceId]: breakdown.totalPoints,
    }

    const detailByRace = {
      ...existingDetailByRace,
      [raceId]: breakdown,
    }

    const totalPoints = Object.values(byRace).reduce((sum, value) => sum + value, 0)

    await scoreRef.set(
      {
        uid: pick.uid,
        groupId: pick.groupId,
        seasonId,
        totalPoints,
        byRace,
        detailByRace,
        wildcardRaceId: wildcardRaceId ?? null,
        lastUpdatedAt: new Date().toISOString(),
      },
      { merge: true },
    )
  }

  for (const groupId of groupIdsTouched) {
    await rebuildLeaderboard(seasonId, raceId, groupId)
    await buildWeeklyRecap(seasonId, groupId, raceId)
    await notifyScoreUpdates(seasonId, groupId, raceId)
  }

  return picksSnapshot.size
}

async function runRaceSync(input: SyncRequest): Promise<{
  seasonId: string
  raceId: string
  scoredPicks: number
  alreadySynced?: boolean
}> {
  const seasonId = input.seasonId ?? (await findActiveSeasonId())
  await syncRaceStatusesForSeason(seasonId)
  const raceSelection = await pickRaceForSync(seasonId, input.raceId)

  if (!raceSelection) {
    throw new Error(`No eligible race found to sync for season ${seasonId}`)
  }

  const { raceId, race } = raceSelection
  const resultSnap = await db.collection('results').doc(raceId).get()
  if (resultSnap.exists) {
    await db.collection('races').doc(raceId).set(
      {
        status: 'completed',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    logger.info('Race already synced, skipped re-ingest', { seasonId, raceId })
    return { seasonId, raceId, scoredPicks: 0, alreadySynced: true }
  }

  const result = await ingestRaceResults(seasonId, raceId, race)
  const scoredPicks = await recomputeRaceScores(seasonId, raceId, result)

  logger.info('Race sync completed', { seasonId, raceId, scoredPicks })
  await db.collection('races').doc(raceId).set(
    {
      status: 'completed',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  return { seasonId, raceId, scoredPicks }
}

async function canManageGroup(uid: string, groupId: string, isPlatformAdmin: boolean): Promise<boolean> {
  if (isPlatformAdmin) return true

  const groupSnap = await db.collection('groups').doc(groupId).get()
  if (!groupSnap.exists) return false
  if (String(groupSnap.data()?.ownerUid ?? '') === uid) return true

  const memberSnap = await db.collection('groups').doc(groupId).collection('members').doc(uid).get()
  if (!memberSnap.exists) return false
  const memberData = memberSnap.data() ?? {}
  const status = String(memberData.status ?? 'pending')
  const role = String(memberData.role ?? 'member')
  return status === 'active' && (role === 'owner' || role === 'admin')
}

async function findLatestResultRaceId(seasonId: string): Promise<string | null> {
  const resultsSnap = await db.collection('results').where('seasonId', '==', seasonId).get()
  if (resultsSnap.empty) return null

  const latest = resultsSnap.docs
    .map((row) => {
      const data = row.data() as Partial<RaceResultDoc>
      return {
        raceId: row.id,
        round: Number(data.round ?? 0),
      }
    })
    .sort((a, b) => b.round - a.round)[0]

  return latest?.raceId ?? null
}

async function recomputeGroupRaceScores(
  seasonId: string,
  raceId: string,
  groupId: string,
  result: RaceResultDoc,
): Promise<number> {
  const season = await getSeason(seasonId)
  const rules = mergeScoringRules(season.scoringRules)

  const picksSnapshot = await db
    .collection('picks')
    .where('seasonId', '==', seasonId)
    .where('raceId', '==', raceId)
    .where('groupId', '==', groupId)
    .get()

  for (const pickDoc of picksSnapshot.docs) {
    const pick = pickDoc.data() as PickDoc
    const scoreRef = db.collection('scores').doc(`${seasonId}_${groupId}_${pick.uid}`)
    const scoreSnap = await scoreRef.get()
    const existingData = (scoreSnap.data() ?? {}) as ScoreDoc
    const existingWildcardRaceId = existingData.wildcardRaceId

    let applyWildcard = false
    let wildcardRaceId = existingWildcardRaceId

    if (pick.wildcard) {
      if (existingWildcardRaceId) {
        applyWildcard = existingWildcardRaceId === raceId
      } else {
        applyWildcard = true
        wildcardRaceId = raceId
      }
    }

    const breakdown = calculatePickScoreBreakdown(pick, result, rules, applyWildcard)

    const existingByRace = (existingData.byRace ?? {}) as Record<string, number>
    const existingDetailByRace =
      (existingData.detailByRace ?? {}) as Record<
        string,
        {
          basePoints: number
          captainBonus: number
          wildcardBonus: number
          totalPoints: number
        }
      >

    const byRace = {
      ...existingByRace,
      [raceId]: breakdown.totalPoints,
    }

    const detailByRace = {
      ...existingDetailByRace,
      [raceId]: breakdown,
    }

    const totalPoints = Object.values(byRace).reduce((sum, value) => sum + value, 0)

    await scoreRef.set(
      {
        uid: pick.uid,
        groupId,
        seasonId,
        totalPoints,
        byRace,
        detailByRace,
        wildcardRaceId: wildcardRaceId ?? null,
        lastUpdatedAt: new Date().toISOString(),
      },
      { merge: true },
    )
  }

  await rebuildLeaderboard(seasonId, raceId, groupId)
  await buildWeeklyRecap(seasonId, groupId, raceId)
  await notifyScoreUpdates(seasonId, groupId, raceId)

  return picksSnapshot.size
}

export const syncLatestResultsAndScores = onSchedule(
  {
    schedule: 'every 6 hours',
    region: 'us-central1',
    timeZone: 'America/New_York',
  },
  async () => {
    try {
      await runRaceSync({})
    } catch (error) {
      logger.warn('Scheduled sync skipped or failed', { error: String(error) })
    }
  },
)

async function postSystemMessageToGroup(groupId: string, text: string): Promise<void> {
  try {
    await db.collection('groups').doc(groupId).collection('messages').add({
      type: 'system',
      text,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    logger.warn('Failed to post system message to group', { groupId, error: String(error) })
  }
}

export const ownerRunGroupRaceSync = onCall(
  {
    region: 'us-central1',
  },
  async (request): Promise<GroupSyncResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const data = (request.data ?? {}) as GroupSyncRequest
    const groupId = data.groupId?.trim() ?? ''
    if (!groupId) {
      throw new HttpsError('invalid-argument', 'groupId is required.')
    }

    const uid = request.auth.uid
    const isPlatformAdmin = request.auth.token.role === 'admin'
    const canManage = await canManageGroup(uid, groupId, isPlatformAdmin)
    if (!canManage) {
      throw new HttpsError('permission-denied', 'Only group owners/admins or platform admins can run group sync.')
    }

    const seasonId = data.seasonId?.trim() || (await findActiveSeasonId())
    const raceId = data.raceId?.trim() || (await findLatestResultRaceId(seasonId))
    if (!raceId) {
      throw new HttpsError('not-found', `No scored race results found for season ${seasonId}.`)
    }

    const resultSnap = await db.collection('results').doc(raceId).get()
    if (!resultSnap.exists) {
      throw new HttpsError('not-found', `Result ${raceId} not found.`)
    }

    const result = resultSnap.data() as RaceResultDoc
    if (result.seasonId !== seasonId) {
      throw new HttpsError('invalid-argument', 'raceId does not belong to the selected seasonId.')
    }

    const scoredPicks = await recomputeGroupRaceScores(seasonId, raceId, groupId, result)
    const syncTime = new Date().toISOString()
    await postSystemMessageToGroup(groupId, `Leaderboard synced at ${syncTime}.`)
    return { seasonId, raceId, groupId, scoredPicks }
  },
)

export const adminRunRaceSync = onCall(
  {
    region: 'us-central1',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    if (request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin role is required.')
    }

    const data = (request.data ?? {}) as SyncRequest

    try {
      return await runRaceSync(data)
    } catch (error) {
      throw new HttpsError('internal', error instanceof Error ? error.message : 'Race sync failed')
    }
  },
)

export const initializeSeasonBootstrap = onCall(
  {
    region: 'us-central1',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const uid = request.auth.uid
    const isAdmin = request.auth.token.role === 'admin'
    await assertSeasonSetupAccess(uid, isAdmin)

    const data = (request.data ?? {}) as InitializeSeasonRequest
    const seasonYear = Number(data.seasonYear ?? new Date().getUTCFullYear())
    if (!Number.isFinite(seasonYear) || seasonYear < 1950 || seasonYear > 2100) {
      throw new HttpsError('invalid-argument', 'seasonYear must be between 1950 and 2100.')
    }

    const seasonId = normalizeSeasonId(data.seasonId, seasonYear)
    const seasonName = (data.seasonName?.trim() || `${seasonYear} Season`).slice(0, 80)
    const activateSeason = data.activateSeason !== false
    const firstRaceName = (data.firstRaceName?.trim() || 'Season Opener').slice(0, 120)
    const firstRaceRound = Number(data.firstRaceRound ?? 1)

    if (!Number.isInteger(firstRaceRound) || firstRaceRound < 1 || firstRaceRound > 99) {
      throw new HttpsError('invalid-argument', 'firstRaceRound must be an integer between 1 and 99.')
    }

    const raceStart = parseRequiredIsoDate(data.raceStartAt, 'raceStartAt')
    const lockAt = data.lockAt?.trim() ? parseRequiredIsoDate(data.lockAt, 'lockAt') : raceStart
    const circuitTimezone = data.circuitTimezone?.trim() || undefined
    const seedDefaultRoster = data.seedDefaultRoster !== false

    const seasonRef = db.collection('seasons').doc(seasonId)
    const raceId = `${seasonId}_r${firstRaceRound}`
    const raceRef = db.collection('races').doc(raceId)
    const seasonSnapshot = await seasonRef.get()

    const batch = db.batch()

    if (activateSeason) {
      const activeSeasonsSnapshot = await db.collection('seasons').where('isActive', '==', true).get()
      for (const activeSeasonDoc of activeSeasonsSnapshot.docs) {
        if (activeSeasonDoc.id === seasonId) continue
        batch.set(
          activeSeasonDoc.ref,
          {
            isActive: false,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      }
    }

    batch.set(
      seasonRef,
      {
        name: seasonName,
        year: seasonYear,
        isActive: activateSeason,
        lockPolicy: {
          mode: 'RACE_START',
        },
        scoringRules: {
          dnfPenalty: {
            enabled: false,
            value: 0,
          },
        },
        updatedAt: FieldValue.serverTimestamp(),
        ...(seasonSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    )

    batch.set(
      raceRef,
      {
        seasonId,
        seasonYear,
        round: firstRaceRound,
        name: firstRaceName,
        raceStartAt: Timestamp.fromDate(raceStart),
        lockAt: Timestamp.fromDate(lockAt),
        ...(circuitTimezone ? { circuitTimezone } : {}),
        status: 'scheduled',
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    await batch.commit()
    const seedResult = await seedRosterIfNeeded(seedDefaultRoster)

    return {
      seasonId,
      raceId,
      activated: activateSeason,
      seasonCreated: !seasonSnapshot.exists,
      rosterSeeded: seedResult,
    }
  },
)

export const importSeasonSchedule = onCall(
  {
    region: 'us-central1',
  },
  async (request): Promise<ImportSeasonScheduleResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const uid = request.auth.uid
    const isAdmin = request.auth.token.role === 'admin'
    await assertSeasonSetupAccess(uid, isAdmin)

    const data = (request.data ?? {}) as ImportSeasonScheduleRequest
    const requestedSeasonId = data.seasonId?.trim()
    if (!requestedSeasonId) {
      throw new HttpsError('invalid-argument', 'seasonId is required.')
    }

    const seasonRef = db.collection('seasons').doc(requestedSeasonId)
    const seasonSnap = await seasonRef.get()
    if (!seasonSnap.exists) {
      throw new HttpsError('not-found', `Season ${requestedSeasonId} not found.`)
    }

    const seasonData = seasonSnap.data() as Partial<SeasonDoc>
    const storedSeasonYear = Number(seasonData.year ?? 0)
    const requestedSeasonYear = Number(data.seasonYear ?? storedSeasonYear)
    if (!Number.isInteger(requestedSeasonYear) || requestedSeasonYear < 1950 || requestedSeasonYear > 2100) {
      throw new HttpsError('invalid-argument', 'seasonYear must be between 1950 and 2100.')
    }
    if (storedSeasonYear > 0 && storedSeasonYear !== requestedSeasonYear) {
      throw new HttpsError(
        'invalid-argument',
        `Season ${requestedSeasonId} year mismatch. Expected ${storedSeasonYear}, received ${requestedSeasonYear}.`,
      )
    }

    const schedule = await fetchSeasonSchedule(requestedSeasonYear)
    if (schedule.length === 0) {
      throw new HttpsError('not-found', `No races returned from Jolpi for season ${requestedSeasonYear}.`)
    }

    const existingRacesSnap = await db.collection('races').where('seasonId', '==', requestedSeasonId).get()
    const existingRaces = new Map(existingRacesSnap.docs.map((doc) => [doc.id, doc]))
    const resultRefs = schedule.map((race) => db.collection('results').doc(`${requestedSeasonId}_r${race.round}`).get())
    const resultSnaps = await Promise.all(resultRefs)
    const resultByRaceId = new Map(resultSnaps.map((snap) => [snap.id, snap.exists]))

    let created = 0
    let updated = 0
    let skippedCompleted = 0

    const writes = schedule.map(async (scheduledRace) => {
      const raceId = `${requestedSeasonId}_r${scheduledRace.round}`
      const raceRef = db.collection('races').doc(raceId)
      const existingRaceSnap = existingRaces.get(raceId)
      const existingRace = existingRaceSnap?.data() as Partial<RaceDoc> | undefined
      const hasResults = resultByRaceId.get(raceId) === true
      const raceStart = scheduledRace.raceStartAt ? new Date(scheduledRace.raceStartAt) : null
      const validRaceStart = raceStart && !Number.isNaN(raceStart.getTime()) ? raceStart : null
      const importedStatus = resolveRaceStatusForImport(validRaceStart, hasResults)

      const basePayload = {
        seasonId: requestedSeasonId,
        seasonYear: requestedSeasonYear,
        round: scheduledRace.round,
        name: scheduledRace.raceName,
        ...(validRaceStart ? { raceStartAt: Timestamp.fromDate(validRaceStart), lockAt: Timestamp.fromDate(validRaceStart) } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }

      if (!existingRaceSnap) {
        created += 1
        await raceRef.set({
          ...basePayload,
          status: importedStatus,
          createdAt: FieldValue.serverTimestamp(),
        })
        return
      }

      if (hasResults) {
        skippedCompleted += 1
        await raceRef.set(
          {
            ...basePayload,
            status: 'completed',
          },
          { merge: true },
        )
        return
      }

      const nextStatus =
        existingRace?.status === 'completed' || existingRace?.status === 'results_ingested'
          ? existingRace.status
          : importedStatus

      updated += 1
      await raceRef.set(
        {
          ...basePayload,
          status: nextStatus,
        },
        { merge: true },
      )
    })

    await Promise.all(writes)

    return {
      seasonId: requestedSeasonId,
      seasonYear: requestedSeasonYear,
      totalFromApi: schedule.length,
      created,
      updated,
      skippedCompleted,
    }
  },
)

export const syncSeasonTimezones = onCall(
  {
    region: 'us-central1',
  },
  async (request): Promise<SyncSeasonTimezonesResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    if (request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin role is required.')
    }

    const data = (request.data ?? {}) as SyncSeasonTimezonesRequest
    const seasonId = data.seasonId?.trim() || (await findActiveSeasonId())
    const seasonSnap = await db.collection('seasons').doc(seasonId).get()

    if (!seasonSnap.exists) {
      throw new HttpsError('not-found', `Season ${seasonId} not found.`)
    }

    const seasonData = seasonSnap.data() as Partial<SeasonDoc>
    const seasonYear = Number(seasonData.year ?? new Date().getUTCFullYear())
    if (!Number.isFinite(seasonYear) || seasonYear < 1950 || seasonYear > 2100) {
      throw new HttpsError('invalid-argument', 'seasonYear must be between 1950 and 2100.')
    }

    const schedule = await fetchSeasonSchedule(seasonYear)
    if (schedule.length === 0) {
      throw new HttpsError('not-found', `No races returned from Jolpi for season ${seasonYear}.`)
    }

    const racesSnap = await db.collection('races').where('seasonId', '==', seasonId).get()
    const raceById = new Map(racesSnap.docs.map((doc) => [doc.id, doc]))

    let updated = 0
    let skipped = 0

    const results: SyncSeasonTimezonesResponse['races'] = []
    const dryRun = data.dryRun === true
    const force = data.force === true

    for (const scheduledRace of schedule) {
      const raceId = `${seasonId}_r${scheduledRace.round}`
      const raceDoc = raceById.get(raceId)
      const circuitTimezone = resolveCircuitTimezone(scheduledRace.latitude, scheduledRace.longitude)

      const raceStartAt = scheduledRace.raceStartAt ? new Date(scheduledRace.raceStartAt) : null
      const existing = raceDoc?.data() as Partial<RaceDoc> | undefined
      const existingStart = timestampToDate(existing?.raceStartAt)
      const effectiveStart = existingStart ?? raceStartAt
      const computedLockAt = effectiveStart ?? null

      if (!raceDoc) {
        skipped += 1
        results.push({
          raceId,
          raceName: scheduledRace.raceName,
          round: scheduledRace.round,
          circuitTimezone,
          raceStartAt: effectiveStart?.toISOString(),
          lockAt: computedLockAt?.toISOString(),
        })
        continue
      }

      const shouldUpdateTimezone = force || !existing?.circuitTimezone
      const shouldUpdateLock = force || !existing?.lockAt

      if (!shouldUpdateTimezone && !shouldUpdateLock) {
        skipped += 1
        results.push({
          raceId,
          raceName: scheduledRace.raceName,
          round: scheduledRace.round,
          circuitTimezone: existing?.circuitTimezone,
          raceStartAt: effectiveStart?.toISOString(),
          lockAt: computedLockAt?.toISOString(),
        })
        continue
      }

      if (!dryRun) {
        const payload: Record<string, unknown> = {
          updatedAt: FieldValue.serverTimestamp(),
        }
        if (shouldUpdateTimezone && circuitTimezone) {
          payload.circuitTimezone = circuitTimezone
        }
        if (shouldUpdateLock && computedLockAt) {
          payload.lockAt = Timestamp.fromDate(computedLockAt)
        }
        if (!existing?.raceStartAt && effectiveStart) {
          payload.raceStartAt = Timestamp.fromDate(effectiveStart)
        }

        await raceDoc.ref.set(payload, { merge: true })
      }

      updated += 1
      results.push({
        raceId,
        raceName: scheduledRace.raceName,
        round: scheduledRace.round,
        circuitTimezone: circuitTimezone ?? existing?.circuitTimezone,
        raceStartAt: effectiveStart?.toISOString(),
        lockAt: computedLockAt?.toISOString(),
      })
    }

    return {
      seasonId,
      seasonYear,
      totalFromApi: schedule.length,
      updated,
      skipped,
      races: results,
    }
  },
)

export const updateRaceCircuitTimezone = onCall(
  {
    region: 'us-central1',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }
    if (request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin role is required.')
    }

    const data = (request.data ?? {}) as UpdateRaceCircuitTimezoneRequest
    const raceId = data.raceId?.trim()
    const circuitTimezone = data.circuitTimezone?.trim()

    if (!raceId) {
      throw new HttpsError('invalid-argument', 'raceId is required.')
    }

    const raceRef = db.collection('races').doc(raceId)
    const raceSnap = await raceRef.get()
    if (!raceSnap.exists) {
      throw new HttpsError('not-found', `Race ${raceId} not found.`)
    }

    await raceRef.set(
      {
        circuitTimezone: circuitTimezone || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    return { raceId, circuitTimezone: circuitTimezone || null }
  },
)

export const updateSeasonScoringRules = onCall(
  {
    region: 'us-central1',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const uid = request.auth.uid
    const isAdmin = request.auth.token.role === 'admin'

    if (!isAdmin) {
      const ownedGroupsSnapshot = await db.collection('groups').where('ownerUid', '==', uid).limit(1).get()
      if (ownedGroupsSnapshot.empty) {
        throw new HttpsError(
          'permission-denied',
          'Only group owners or platform admins can update scoring rules.',
        )
      }
    }

    const data = (request.data ?? {}) as UpdateSeasonScoringRulesRequest
    const seasonId = data.seasonId?.trim() || (await findActiveSeasonId())
    const seasonRef = db.collection('seasons').doc(seasonId)
    const seasonSnapshot = await seasonRef.get()

    if (!seasonSnapshot.exists) {
      throw new HttpsError('not-found', `Season ${seasonId} does not exist.`)
    }

    const scoringRules = parseScoringRulesInput(data.scoringRules)

    await seasonRef.set(
      {
        scoringRules,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    return {
      seasonId,
      scoringRules,
    }
  },
)

export const getLiveRoster = onCall(
  {
    region: 'us-central1',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const data = (request.data ?? {}) as LiveRosterRequest

    try {
      const seasonYear = await resolveRosterSeasonYear(data)
      const roster = await fetchLiveRosterWithFallback(seasonYear)

      return {
        source: 'jolpi',
        seasonYear: roster.seasonYear,
        drivers: roster.drivers,
        constructors: roster.constructors,
      }
    } catch (error) {
      throw new HttpsError(
        'internal',
        error instanceof Error ? error.message : 'Failed to fetch live roster.',
      )
    }
  },
)

export const getStatsBootstrap = onCall(
  {
    region: 'us-central1',
  },
  async (request): Promise<StatsBootstrapResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const data = (request.data ?? {}) as GetStatsBootstrapRequest
    const seasonId = data.seasonId?.trim() || (await findActiveSeasonId())
    const seasonSnap = await db.collection('seasons').doc(seasonId).get()

    if (!seasonSnap.exists) {
      throw new HttpsError('not-found', `Season ${seasonId} not found.`)
    }

    const seasonData = seasonSnap.data() as Partial<SeasonDoc>
    const seasonName = String(seasonData.name ?? seasonId)
    const seasonYear = Number(seasonData.year ?? new Date().getUTCFullYear())
    const scoringRules = mergeScoringRules(seasonData.scoringRules)

    const [racesResult, driversResult, constructorsResult, resultsSnap] = await Promise.all([
      fetchStatsRaceList(seasonId, seasonYear),
      fetchStatsDriverOptions(seasonYear),
      fetchStatsConstructorOptions(seasonYear),
      db.collection('results').where('seasonId', '==', seasonId).get(),
    ])

    const results = resultsSnap.docs
      .map((resultDoc) => {
        const data = resultDoc.data() as Partial<RaceResultDoc>
        return {
          raceId: resultDoc.id,
          round: Number(data.round ?? 0),
          raceName: typeof data.raceName === 'string' ? data.raceName : undefined,
          podium: (data.podium as [string, string, string]) ?? ['', '', ''],
          driverResults: Array.isArray(data.driverResults)
            ? (data.driverResults as StatsBootstrapResultDriverRow[])
            : [],
          driverMovement:
            data.driverMovement && typeof data.driverMovement === 'object'
              ? (data.driverMovement as Record<string, number>)
              : {},
        }
      })
      .sort((a, b) => a.round - b.round)

    return {
      source: {
        schedule: racesResult.source,
        drivers: driversResult.source,
        constructors: constructorsResult.source,
        results: 'firestore',
      },
      seasonId,
      seasonName,
      seasonYear,
      races: racesResult.races,
      results,
      drivers: driversResult.drivers,
      constructors: constructorsResult.constructors,
      scoringRules: {
        podiumPoints: scoringRules.podiumPoints,
        driverGain: scoringRules.standingsMovement.driverGain,
        dnfPenalty: scoringRules.dnfPenalty,
      },
    }
  },
)

export const requestGroupAccess = onCall(
  {
    region: 'us-central1',
  },
  async (request): Promise<RequestGroupAccessResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const data = (request.data ?? {}) as RequestGroupAccessRequest
    const groupId = data.groupId?.trim() ?? ''
    const joinCode = data.joinCode?.trim().toUpperCase() ?? ''

    if (!groupId) {
      throw new HttpsError('invalid-argument', 'Group id is required.')
    }

    if (!joinCode) {
      throw new HttpsError('invalid-argument', 'Join code is required.')
    }

    const uid = request.auth.uid
    const groupRef = db.collection('groups').doc(groupId)
    const groupSnapshot = await groupRef.get()

    if (!groupSnapshot.exists) {
      throw new HttpsError('not-found', 'Selected group was not found.')
    }

    const groupData = groupSnapshot.data() ?? {}
    const storedCode = String(groupData.joinCode ?? '').trim().toUpperCase()
    if (!storedCode || storedCode !== joinCode) {
      throw new HttpsError('permission-denied', 'Invite code does not match the selected group.')
    }

    const memberRef = groupRef.collection('members').doc(uid)
    const memberSnapshot = await memberRef.get()
    if (memberSnapshot.exists) {
      const status = String(memberSnapshot.data()?.status ?? 'pending') === 'active' ? 'active' : 'pending'

      if (status === 'active') {
        await db
          .collection('users')
          .doc(uid)
          .set(
            {
              activeGroupId: groupId,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
      }

      return {
        groupId,
        status,
      }
    }

    const ownerUid = String(groupData.ownerUid ?? '')
    const displayName = String(request.auth.token.name ?? '').trim()
    const email = String(request.auth.token.email ?? '').trim()

    if (ownerUid && ownerUid === uid) {
      await memberRef.set(
        {
          uid,
          displayName: displayName || 'F1 Player',
          email,
          role: 'owner',
          status: 'active',
          approvedAt: FieldValue.serverTimestamp(),
          joinedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      await db
        .collection('users')
        .doc(uid)
        .set(
          {
            activeGroupId: groupId,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )

      return {
        groupId,
        status: 'active',
      }
    }

    await memberRef.set(
      {
        uid,
        displayName: displayName || 'F1 Player',
        email,
        role: 'member',
        status: 'pending',
        requestedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    return {
      groupId,
      status: 'pending',
    }
  },
)

export const getMyGroups = onCall(
  {
    region: 'us-central1',
  },
  async (request): Promise<GetMyGroupsResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const uid = request.auth.uid
    const groupsById = new Map<
      string,
      {
        id: string
        name: string
        joinCode: string
        role: 'owner' | 'admin' | 'member'
        status: 'active' | 'pending'
      }
    >()

    const ownerGroupsSnapshot = await db.collection('groups').where('ownerUid', '==', uid).get()

    const groupIds = new Set<string>()
    for (const groupDoc of ownerGroupsSnapshot.docs) {
      groupIds.add(groupDoc.id)
    }

    const membershipByGroup = new Map<string, { role: 'owner' | 'admin' | 'member'; status: 'active' | 'pending' }>()
    try {
      const membershipSnapshot = await db.collectionGroup('members').where('uid', '==', uid).get()
      for (const memberDoc of membershipSnapshot.docs) {
        const groupRef = memberDoc.ref.parent.parent
        if (!groupRef) continue
        groupIds.add(groupRef.id)

        const data = memberDoc.data()
        const rawRole = String(data.role ?? 'member')
        const rawStatus = String(data.status ?? 'pending')
        membershipByGroup.set(groupRef.id, {
          role: rawRole === 'owner' || rawRole === 'admin' ? rawRole : 'member',
          status: rawStatus === 'active' ? 'active' : 'pending',
        })
      }
    } catch (error) {
      logger.warn('getMyGroups collectionGroup fallback path triggered', { uid, error: String(error) })

      // Fallback: scan groups and probe the user's member doc in each group.
      const allGroupsSnapshot = await db.collection('groups').get()
      await Promise.all(
        allGroupsSnapshot.docs.map(async (groupDoc) => {
          const memberDoc = await groupDoc.ref.collection('members').doc(uid).get()
          if (!memberDoc.exists) return

          groupIds.add(groupDoc.id)
          const data = memberDoc.data() ?? {}
          const rawRole = String(data.role ?? 'member')
          const rawStatus = String(data.status ?? 'pending')
          membershipByGroup.set(groupDoc.id, {
            role: rawRole === 'owner' || rawRole === 'admin' ? rawRole : 'member',
            status: rawStatus === 'active' ? 'active' : 'pending',
          })
        }),
      )
    }

    const groupDocs = await Promise.all(Array.from(groupIds).map((groupId) => db.collection('groups').doc(groupId).get()))

    for (const groupDoc of groupDocs) {
      if (!groupDoc.exists) continue

      const data = groupDoc.data() ?? {}
      const ownerUid = String(data.ownerUid ?? '')
      const membership = membershipByGroup.get(groupDoc.id)

      const role: 'owner' | 'admin' | 'member' =
        ownerUid === uid ? 'owner' : membership?.role ?? 'member'
      const status: 'active' | 'pending' = ownerUid === uid ? 'active' : membership?.status ?? 'pending'

      groupsById.set(groupDoc.id, {
        id: groupDoc.id,
        name: String(data.name ?? groupDoc.id),
        joinCode: String(data.joinCode ?? ''),
        role,
        status,
      })
    }

    return {
      groups: Array.from(groupsById.values()).sort((a, b) => a.name.localeCompare(b.name)),
    }
  },
)
export const getJoinableGroups = onCall(
  {
    region: 'us-central1',
  },
  async (request): Promise<GetJoinableGroupsResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const groupsSnapshot = await db.collection('groups').select('name').get()
    const groups = groupsSnapshot.docs
      .map((groupDoc) => {
        const data = groupDoc.data() ?? {}
        return {
          id: groupDoc.id,
          name: String(data.name ?? groupDoc.id),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    return { groups }
  },
)
export const getWeeklyRecap = onCall(
  {
    region: 'us-central1',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const data = (request.data ?? {}) as GetWeeklyRecapRequest
    const seasonId = data.seasonId?.trim() || (await findActiveSeasonId())
    const groupId = data.groupId?.trim()
    if (!groupId) {
      throw new HttpsError('invalid-argument', 'groupId is required.')
    }

    const memberSnap = await db.collection('groups').doc(groupId).collection('members').doc(request.auth.uid).get()
    const isAdmin = request.auth.token.role === 'admin'
    if (!isAdmin && (!memberSnap.exists || memberSnap.data()?.status !== 'active')) {
      throw new HttpsError('permission-denied', 'Active group membership is required.')
    }

    const raceId =
      data.raceId?.trim() ||
      String((await db.collection('leaderboards').doc(`${seasonId}_${groupId}`).get()).data()?.lastRaceId ?? '')

    if (!raceId) {
      throw new HttpsError('not-found', 'No scored race found for this group yet.')
    }

    const recap = await buildWeeklyRecap(seasonId, groupId, raceId)
    if (!recap) {
      throw new HttpsError('not-found', 'Weekly recap not available for this race.')
    }

    return recap
  },
)

export const saveNotificationPreferences = onCall(
  {
    region: 'us-central1',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const data = (request.data ?? {}) as NotificationPreferenceRequest
    await db.collection('notificationPrefs').doc(request.auth.uid).set(
      {
        uid: request.auth.uid,
        emailEnabled: data.emailEnabled !== false,
        pushEnabled: data.pushEnabled !== false,
        lockReminderMinutesBefore: Number.isFinite(Number(data.lockReminderMinutesBefore))
          ? Number(data.lockReminderMinutesBefore)
          : 60,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    return { ok: true }
  },
)

export const getSeasonAwards = onCall(
  {
    region: 'us-central1',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const data = (request.data ?? {}) as GetSeasonAwardsRequest
    const seasonId = data.seasonId?.trim() || (await findActiveSeasonId())
    const groupId = data.groupId?.trim()
    if (!groupId) {
      throw new HttpsError('invalid-argument', 'groupId is required.')
    }

    const [picksSnap, resultsSnap, leaderboardSnap] = await Promise.all([
      db.collection('picks').where('seasonId', '==', seasonId).where('groupId', '==', groupId).get(),
      db.collection('results').where('seasonId', '==', seasonId).get(),
      db.collection('leaderboards').doc(`${seasonId}_${groupId}`).get(),
    ])

    const resultByRace = new Map<string, RaceResultDoc>()
    for (const row of resultsSnap.docs) {
      resultByRace.set(row.id, row.data() as RaceResultDoc)
    }

    const accuracy = new Map<string, number>()
    for (const row of picksSnap.docs) {
      const pick = row.data() as PickDoc
      const result = resultByRace.get(pick.raceId)
      if (!result) continue

      const matches =
        Number(pick.podium.p1 === result.podium[0]) + Number(pick.podium.p2 === result.podium[1]) + Number(pick.podium.p3 === result.podium[2])
      accuracy.set(pick.uid, (accuracy.get(pick.uid) ?? 0) + matches)
    }

    const scoresSnap = await db.collection('scores').where('seasonId', '==', seasonId).where('groupId', '==', groupId).get()
    const scoreRows = scoresSnap.docs.map((row) => row.data() as ScoreDoc)

    const riskRows = scoreRows
      .map((row) => {
        const values = Object.values(row.byRace ?? {})
        if (values.length === 0) return { uid: row.uid, volatility: 0 }
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length
        const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
        return { uid: row.uid, volatility: Math.sqrt(variance) }
      })
      .sort((a, b) => b.volatility - a.volatility)

    const leaderboardEntries = (leaderboardSnap.data()?.entries ?? []) as Array<{
      uid: string
      displayName: string
      rankDelta: number
    }>

    const accurateWinner = Array.from(accuracy.entries()).sort((a, b) => b[1] - a[1])[0]
    const riskWinner = riskRows[0]
    const comebackWinner = leaderboardEntries.slice().sort((a, b) => b.rankDelta - a.rankDelta)[0]

    return {
      seasonId,
      groupId,
      mostAccurate: accurateWinner ? { uid: accurateWinner[0], score: accurateWinner[1] } : null,
      riskTaker: riskWinner ? { uid: riskWinner.uid, volatility: Math.round(riskWinner.volatility * 100) / 100 } : null,
      comebackOfTheYear: comebackWinner
        ? {
            uid: comebackWinner.uid,
            displayName: comebackWinner.displayName,
            rankDelta: comebackWinner.rankDelta,
          }
        : null,
    }
  },
)

export const simulateSeasonScoring = onCall(
  {
    region: 'us-central1',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required.')
    }

    const isAdmin = request.auth.token.role === 'admin'
    if (!isAdmin) {
      throw new HttpsError('permission-denied', 'Admin role is required.')
    }

    const data = (request.data ?? {}) as SimulateScoringRequest
    const seasonId = data.seasonId?.trim() || (await findActiveSeasonId())
    const rules = parseScoringRulesInput(data.scoringRules)

    const [resultsSnap, picksSnap, currentScoresSnap] = await Promise.all([
      db.collection('results').where('seasonId', '==', seasonId).get(),
      db.collection('picks').where('seasonId', '==', seasonId).get(),
      db.collection('scores').where('seasonId', '==', seasonId).get(),
    ])

    const resultByRace = new Map<string, RaceResultDoc>()
    for (const row of resultsSnap.docs) {
      resultByRace.set(row.id, row.data() as RaceResultDoc)
    }

    const raceOrder = Array.from(resultByRace.values()).sort((a, b) => a.round - b.round).map((row) => row.raceId)
    const raceIndex = new Map(raceOrder.map((raceId, index) => [raceId, index]))

    const pointsByUserGroup = new Map<string, number>()
    const wildcardByUserGroup = new Map<string, string>()

    const orderedPicks = picksSnap.docs
      .map((row) => row.data() as PickDoc)
      .filter((pick) => resultByRace.has(pick.raceId))
      .sort((a, b) => (raceIndex.get(a.raceId) ?? 0) - (raceIndex.get(b.raceId) ?? 0))

    for (const pick of orderedPicks) {
      const result = resultByRace.get(pick.raceId)
      if (!result) continue

      const key = `${pick.groupId}::${pick.uid}`
      const wildcardRaceId = wildcardByUserGroup.get(key)
      const applyWildcard = pick.wildcard === true && (!wildcardRaceId || wildcardRaceId === pick.raceId)
      if (applyWildcard && !wildcardRaceId) {
        wildcardByUserGroup.set(key, pick.raceId)
      }

      const breakdown = calculatePickScoreBreakdown(pick, result, rules, applyWildcard)
      pointsByUserGroup.set(key, (pointsByUserGroup.get(key) ?? 0) + breakdown.totalPoints)
    }

    const currentByUserGroup = new Map<string, number>()
    for (const row of currentScoresSnap.docs) {
      const score = row.data() as ScoreDoc
      currentByUserGroup.set(`${score.groupId}::${score.uid}`, score.totalPoints)
    }

    const rows = Array.from(pointsByUserGroup.entries())
      .map(([key, simulatedTotal]) => {
        const currentTotal = currentByUserGroup.get(key) ?? 0
        const delimiterIndex = key.indexOf('::')
        const groupId = delimiterIndex >= 0 ? key.slice(0, delimiterIndex) : key
        const uid = delimiterIndex >= 0 ? key.slice(delimiterIndex + 2) : ''
        return {
          groupId,
          uid,
          currentTotal,
          simulatedTotal,
          delta: simulatedTotal - currentTotal,
        }
      })
      .sort((a, b) => b.delta - a.delta)

    return {
      seasonId,
      sampleSize: rows.length,
      topGainers: rows.slice(0, 25),
      topLosers: rows.slice(-25),
    }
  },
)

export const sendLockReminderNotifications = onSchedule(
  {
    schedule: 'every 30 minutes',
    region: 'us-central1',
    timeZone: 'America/New_York',
  },
  async () => {
    const now = new Date()
    const activeSeasonId = await findActiveSeasonId()

    const racesSnap = await db.collection('races').where('seasonId', '==', activeSeasonId).get()
    const upcoming = racesSnap.docs
      .map((row) => ({ id: row.id, race: row.data() as RaceDoc }))
      .filter((row) => {
        const lockAt = timestampToDate(row.race.lockAt) ?? timestampToDate(row.race.raceStartAt)
        if (!lockAt) return false
        const diffMinutes = (lockAt.getTime() - now.getTime()) / 60_000
        return diffMinutes > 0 && diffMinutes <= 60 && (row.race.status ?? 'scheduled') === 'scheduled'
      })

    if (upcoming.length === 0) return

    const membersSnap = await db.collectionGroup('members').where('status', '==', 'active').get()
    const uidSet = new Set(membersSnap.docs.map((row) => String(row.data().uid || row.id)))

    for (const race of upcoming) {
      for (const uid of uidSet) {
        const docId = `lock_${uid}_${race.id}`
        await db.collection('notifications').doc(docId).set(
          {
            uid,
            type: 'lock_reminder',
            title: 'Race lock reminder',
            body: `${race.race.name} locks within 60 minutes. Submit picks now.`,
            data: {
              raceId: race.id,
              seasonId: activeSeasonId,
            },
            createdAt: FieldValue.serverTimestamp(),
            readAt: null,
          },
          { merge: true },
        )
      }
    }
  },
)

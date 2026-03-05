import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { fetchConstructorStandings, fetchDriverStandings, fetchRaceResults, isDnfStatus } from './jolpi'
import { calculatePickScore, mergeScoringRules } from './scoring'
import type { PickDoc, RaceDoc, RaceResultDoc, ScoreDoc, SeasonDoc } from './types'

initializeApp()
const db = getFirestore()

type SyncRequest = {
  seasonId?: string
  raceId?: string
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
  seedDefaultRoster?: boolean
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

    const racePoints = calculatePickScore(pick, result, rules)
    const scoreRef = db.collection('scores').doc(`${seasonId}_${pick.groupId}_${pick.uid}`)
    const scoreSnap = await scoreRef.get()

    const existingByRace = (scoreSnap.data()?.byRace ?? {}) as Record<string, number>
    const byRace = {
      ...existingByRace,
      [raceId]: racePoints,
    }

    const totalPoints = Object.values(byRace).reduce((sum, value) => sum + value, 0)

    await scoreRef.set(
      {
        uid: pick.uid,
        groupId: pick.groupId,
        seasonId,
        totalPoints,
        byRace,
        lastUpdatedAt: new Date().toISOString(),
      },
      { merge: true },
    )
  }

  for (const groupId of groupIdsTouched) {
    await rebuildLeaderboard(seasonId, raceId, groupId)
  }

  return picksSnapshot.size
}

async function runRaceSync(input: SyncRequest): Promise<{ seasonId: string; raceId: string; scoredPicks: number }> {
  const seasonId = input.seasonId ?? (await findActiveSeasonId())
  await syncRaceStatusesForSeason(seasonId)
  const raceSelection = await pickRaceForSync(seasonId, input.raceId)

  if (!raceSelection) {
    throw new Error(`No eligible race found to sync for season ${seasonId}`)
  }

  const { raceId, race } = raceSelection
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

    if (!isAdmin) {
      const ownedGroupsSnapshot = await db.collection('groups').where('ownerUid', '==', uid).limit(1).get()
      if (ownedGroupsSnapshot.empty) {
        throw new HttpsError('permission-denied', 'Only group owners or platform admins can initialize seasons.')
      }
    }

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

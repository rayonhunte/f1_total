import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from '../auth/useAuth'
import { db, functions } from '../lib/firebase'
import { resolveSeasonForClient } from '../lib/season'

type DriverOption = {
  id: string
  name: string
  code?: string
  fantasyCost?: number
}

type ConstructorOption = {
  id: string
  name: string
  fantasyCost?: number
}

type RaceInfo = {
  id: string
  name: string
  seasonId: string
  seasonYear?: number
  round: number
  raceStartAt?: string
  lockAt?: string
  circuitTimezone?: string
  status?: 'scheduled' | 'in_progress' | 'completed' | 'results_ingested'
}

type LiveRosterRequest = {
  seasonId?: string
  seasonYear?: number
}

type LiveRosterResponse = {
  source: 'jolpi'
  seasonYear: number
  drivers: DriverOption[]
  constructors: ConstructorOption[]
}

type PicksBootstrap = {
  seasonId: string
  seasonName: string
  seasonMode: 'active' | 'fallback'
  races: RaceInfo[]
  race: RaceInfo
  drivers: DriverOption[]
  constructors: ConstructorOption[]
  scoringRules: {
    captainMultiplier: number
    wildcardMultiplier: number
    budgetMode: {
      enabled: boolean
      cap: number
      requireSingleConstructor: boolean
    }
  }
  wildcardUsedRaceId: string | null
  recentResults: Array<{
    raceId: string
    round: number
    podium: [string, string, string]
    driverResults: Array<{ driverId: string; constructorId: string; points: number; dnf: boolean }>
  }>
  existingPick?: {
    podium: {
      p1: string
      p2: string
      p3: string
    }
    constructors: string[]
    captainDriverId?: string
    wildcard?: boolean
  }
}

const picksSchema = z
  .object({
    p1: z.string().min(1, 'Select a driver for P1'),
    p2: z.string().min(1, 'Select a driver for P2'),
    p3: z.string().min(1, 'Select a driver for P3'),
    constructors: z.array(z.string()).max(2, 'Choose up to two constructors'),
  })
  .refine((values) => new Set([values.p1, values.p2, values.p3]).size === 3, {
    message: 'Each podium position must use a different driver.',
    path: ['p3'],
  })
  .refine((values) => new Set(values.constructors).size === values.constructors.length, {
    message: 'Constructor picks must be unique.',
    path: ['constructors'],
  })

function toDate(value?: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function computeRaceLockInfo(race: RaceInfo, now: Date) {
  const lockAt = toDate(race.lockAt)
  const raceStart = toDate(race.raceStartAt)
  const effectiveLockAt = lockAt ?? raceStart
  const status = race.status ?? 'scheduled'
  const isStatusLocked = status === 'in_progress' || status === 'completed' || status === 'results_ingested'
  const isTimeLocked = effectiveLockAt ? effectiveLockAt <= now : false
  const isLocked = isStatusLocked || isTimeLocked

  let stateLabel = 'Open'
  if (status === 'completed' || status === 'results_ingested') stateLabel = 'Completed'
  else if (status === 'in_progress') stateLabel = 'In Progress (Locked)'
  else if (isLocked) stateLabel = 'Locked'

  return {
    effectiveLockAt,
    isLocked,
    status,
    stateLabel,
  }
}

function isRaceCompleted(race: RaceInfo): boolean {
  return race.status === 'completed' || race.status === 'results_ingested'
}

function getDefaultRace(races: RaceInfo[], now: Date): RaceInfo {
  const nextUnlockedRace = races.find((race) => {
    if (isRaceCompleted(race)) return false
    return !computeRaceLockInfo(race, now).isLocked
  })
  if (nextUnlockedRace) return nextUnlockedRace

  const nextIncompleteRace = races.find((race) => !isRaceCompleted(race))
  if (nextIncompleteRace) return nextIncompleteRace

  return races[races.length - 1]
}

function formatCountdown(lockAt: Date | null, nowMs: number): string {
  if (!lockAt) return 'No lock configured'
  const diff = lockAt.getTime() - nowMs
  if (diff <= 0) return 'Locked'

  const totalSeconds = Math.floor(diff / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  }

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

async function fetchRacesForSeason(seasonId: string): Promise<RaceInfo[]> {
  const racesQuery = query(collection(db, 'races'), where('seasonId', '==', seasonId))
  const racesSnapshot = await getDocs(racesQuery)

  if (racesSnapshot.empty) {
    throw new Error('No races found for the selected season.')
  }

  return racesSnapshot.docs
    .map((raceDoc) => {
      const data = raceDoc.data()
      const rawStatus = (data.status as string | undefined) ?? 'scheduled'
      const status: RaceInfo['status'] =
        rawStatus === 'completed' || rawStatus === 'in_progress' || rawStatus === 'results_ingested'
          ? rawStatus
          : 'scheduled'

      return {
        id: raceDoc.id,
        name: (data.name as string | undefined) ?? raceDoc.id,
        seasonId,
        seasonYear: Number(data.seasonYear ?? 0) || undefined,
        round: Number(data.round ?? 0),
        raceStartAt: data.raceStartAt
          ? typeof data.raceStartAt.toDate === 'function'
            ? data.raceStartAt.toDate().toISOString()
            : String(data.raceStartAt)
          : undefined,
        lockAt: data.lockAt
          ? typeof data.lockAt.toDate === 'function'
            ? data.lockAt.toDate().toISOString()
            : String(data.lockAt)
          : undefined,
        circuitTimezone: (data.circuitTimezone as string | undefined) || undefined,
        status,
      } satisfies RaceInfo
    })
    .sort((a, b) => a.round - b.round)
}

async function fetchOptions<T extends { id: string; name: string }>(
  collectionName: 'drivers' | 'constructors',
): Promise<T[]> {
  const snapshot = await getDocs(collection(db, collectionName))

  return snapshot.docs
    .map((item) => {
      const data = item.data()
      return {
        id: item.id,
        name: (data.name as string | undefined) ?? item.id,
        fantasyCost: Number(data.fantasyCost ?? (collectionName === 'drivers' ? 25 : 30)),
        ...(collectionName === 'drivers' ? { code: data.code as string | undefined } : {}),
      } as unknown as T
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchLiveRoster(seasonId: string, seasonYear?: number): Promise<LiveRosterResponse> {
  const callable = httpsCallable<LiveRosterRequest, LiveRosterResponse>(functions, 'getLiveRoster')
  const response = await callable({
    seasonId,
    seasonYear,
  })

  const drivers = (response.data.drivers ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
  const constructors = (response.data.constructors ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    source: response.data.source,
    seasonYear: response.data.seasonYear,
    drivers,
    constructors,
  }
}

async function fetchPicksBootstrap(uid: string, groupId: string, selectedRaceId?: string): Promise<PicksBootstrap> {
  const season = await resolveSeasonForClient()
  const seasonId = season.id
  const seasonSnapshot = await getDoc(doc(db, 'seasons', seasonId))
  const seasonRules = (seasonSnapshot.data()?.scoringRules ?? {}) as Record<string, unknown>

  const scoringRules = {
    captainMultiplier: Number(seasonRules.captainMultiplier ?? 1.5),
    wildcardMultiplier: Number(seasonRules.wildcardMultiplier ?? 2),
    budgetMode: {
      enabled: Boolean((seasonRules.budgetMode as Record<string, unknown> | undefined)?.enabled ?? false),
      cap: Number((seasonRules.budgetMode as Record<string, unknown> | undefined)?.cap ?? 100),
      requireSingleConstructor:
        (seasonRules.budgetMode as Record<string, unknown> | undefined)?.requireSingleConstructor !== false,
    },
  }

  const races = await fetchRacesForSeason(seasonId)
  const now = new Date()
  const preferredRace = selectedRaceId ? races.find((race) => race.id === selectedRaceId) : undefined
  const race = preferredRace ?? getDefaultRace(races, now)

  let drivers: DriverOption[] = []
  let constructors: ConstructorOption[] = []

  try {
    const liveRoster = await fetchLiveRoster(seasonId, race.seasonYear)
    drivers = liveRoster.drivers
    constructors = liveRoster.constructors
  } catch {
    ;[drivers, constructors] = await Promise.all([
      fetchOptions<DriverOption>('drivers'),
      fetchOptions<ConstructorOption>('constructors'),
    ])
  }

  const pickId = `${seasonId}_${race.id}_${groupId}_${uid}`
  const [pickSnapshot, picksByUserSnapshot, recentResultsSnapshot] = await Promise.all([
    getDoc(doc(db, 'picks', pickId)),
    getDocs(
      query(
        collection(db, 'picks'),
        where('uid', '==', uid),
        where('groupId', '==', groupId),
        where('seasonId', '==', seasonId),
      ),
    ),
    getDocs(query(collection(db, 'results'), where('seasonId', '==', seasonId))),
  ])

  const wildcardUsedRaceId =
    picksByUserSnapshot.docs
      .map((row) => row.data())
      .find((row) => row.uid === uid && row.wildcard === true)?.raceId ?? null

  const recentResults = recentResultsSnapshot.docs
    .map((row) => {
      const data = row.data()
      return {
        raceId: row.id,
        round: Number(data.round ?? 0),
        podium: (data.podium as [string, string, string]) ?? ['', '', ''],
        driverResults: (data.driverResults as Array<{ driverId: string; constructorId: string; points: number; dnf: boolean }>) ?? [],
      }
    })
    .sort((a, b) => b.round - a.round)
    .slice(0, 5)

  return {
    seasonId,
    seasonName: season.name,
    seasonMode: season.mode,
    races,
    race,
    drivers,
    constructors,
    scoringRules,
    wildcardUsedRaceId,
    recentResults,
    existingPick: pickSnapshot.exists()
      ? {
          podium: pickSnapshot.data().podium as { p1: string; p2: string; p3: string },
          constructors: (pickSnapshot.data().constructors as string[]) ?? [],
          captainDriverId: (pickSnapshot.data().captainDriverId as string | undefined) ?? undefined,
          wildcard: pickSnapshot.data().wildcard === true,
        }
      : undefined,
  }
}

export function PicksPage() {
  const { user, activeGroupId } = useAuth()
  const queryClient = useQueryClient()
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedRaceId, setSelectedRaceId] = useState<string>('')
  const [captainDriverId, setCaptainDriverId] = useState<string>('')
  const [wildcardEnabled, setWildcardEnabled] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [podiumSelections, setPodiumSelections] = useState<{ p1: string; p2: string; p3: string }>({
    p1: '',
    p2: '',
    p3: '',
  })
  const focusChipRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const bootstrapQuery = useQuery({
    queryKey: ['picks-bootstrap', user?.uid, activeGroupId, selectedRaceId],
    queryFn: () => fetchPicksBootstrap(user!.uid, activeGroupId!, selectedRaceId || undefined),
    enabled: Boolean(user?.uid && activeGroupId),
  })

  useEffect(() => {
    const currentRaceId = bootstrapQuery.data?.race?.id
    if (!currentRaceId) return
    if (selectedRaceId !== currentRaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync selected race when bootstrap race changes
      setSelectedRaceId(currentRaceId)
    }
  }, [bootstrapQuery.data?.race?.id, selectedRaceId])

  const existingPodium = bootstrapQuery.data?.existingPick?.podium
  const existingCaptain = bootstrapQuery.data?.existingPick?.captainDriverId
  const existingWildcard = bootstrapQuery.data?.existingPick?.wildcard
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync form from server when existing pick loads
    setPodiumSelections({
      p1: existingPodium?.p1 ?? '',
      p2: existingPodium?.p2 ?? '',
      p3: existingPodium?.p3 ?? '',
    })
    setCaptainDriverId(existingCaptain ?? '')
    setWildcardEnabled(existingWildcard === true)
  }, [existingPodium?.p1, existingPodium?.p2, existingPodium?.p3, existingCaptain, existingWildcard])

  const lockInfo = useMemo(() => {
    const race = bootstrapQuery.data?.race
    if (!race) {
      return {
        effectiveLockAt: null as Date | null,
        isLocked: false,
        status: 'scheduled' as RaceInfo['status'],
        stateLabel: 'Open',
      }
    }
    return computeRaceLockInfo(race, new Date(nowMs))
  }, [bootstrapQuery.data, nowMs])

  const focusRaceId = useMemo(() => {
    const data = bootstrapQuery.data
    if (!data) return ''
    return selectedRaceId || getDefaultRace(data.races, new Date(nowMs)).id || data.race.id
  }, [bootstrapQuery.data, selectedRaceId, nowMs])

  const countdownLabel = useMemo(() => formatCountdown(lockInfo.effectiveLockAt, nowMs), [lockInfo.effectiveLockAt, nowMs])

  const hints = useMemo(() => {
    const data = bootstrapQuery.data
    if (!data) {
      return {
        safeDrivers: [] as DriverOption[],
        stableConstructors: [] as ConstructorOption[],
        deadDriverIds: new Set<string>(),
        swapSuggestions: [] as DriverOption[],
      }
    }

    const driverStats = new Map<string, { races: number; points: number; dnfs: number }>()
    const constructorStats = new Map<string, { races: number; points: number }>()

    for (const race of data.recentResults) {
      for (const row of race.driverResults) {
        const d = driverStats.get(row.driverId) ?? { races: 0, points: 0, dnfs: 0 }
        d.races += 1
        d.points += Number(row.points ?? 0)
        if (row.dnf) d.dnfs += 1
        driverStats.set(row.driverId, d)

        const c = constructorStats.get(row.constructorId) ?? { races: 0, points: 0 }
        c.races += 1
        c.points += Number(row.points ?? 0)
        constructorStats.set(row.constructorId, c)
      }
    }

    const safeDrivers = data.drivers
      .slice()
      .sort((a, b) => {
        const aStats = driverStats.get(a.id)
        const bStats = driverStats.get(b.id)
        const aRaces = Math.max(1, aStats?.races ?? 1)
        const bRaces = Math.max(1, bStats?.races ?? 1)
        const aScore = (aStats?.points ?? 0) / aRaces - ((aStats?.dnfs ?? 0) / aRaces) * 8
        const bScore = (bStats?.points ?? 0) / bRaces - ((bStats?.dnfs ?? 0) / bRaces) * 8
        return bScore - aScore
      })
      .slice(0, 4)

    const stableConstructors = data.constructors
      .slice()
      .sort((a, b) => {
        const aStats = constructorStats.get(a.id)
        const bStats = constructorStats.get(b.id)
        const aAvg = (aStats?.points ?? 0) / Math.max(1, aStats?.races ?? 1)
        const bAvg = (bStats?.points ?? 0) / Math.max(1, bStats?.races ?? 1)
        return bAvg - aAvg
      })
      .slice(0, 3)

    const deadDriverIds = new Set<string>()
    for (const [driverId, stats] of driverStats.entries()) {
      if (stats.races >= 2 && stats.dnfs / stats.races >= 0.5) {
        deadDriverIds.add(driverId)
      }
    }

    const selected = new Set([podiumSelections.p1, podiumSelections.p2, podiumSelections.p3].filter(Boolean))
    const swapSuggestions = safeDrivers.filter((driver) => !selected.has(driver.id)).slice(0, 3)

    return {
      safeDrivers,
      stableConstructors,
      deadDriverIds,
      swapSuggestions,
    }
  }, [bootstrapQuery.data, podiumSelections.p1, podiumSelections.p2, podiumSelections.p3])

  useEffect(() => {
    if (!focusChipRef.current) return
    if (typeof window === 'undefined') return
    if (!window.matchMedia('(max-width: 900px)').matches) return

    focusChipRef.current.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    })
  }, [focusRaceId])

  const saveMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      if (!user || !activeGroupId) throw new Error('You must be signed in and have an active group.')
      if (!bootstrapQuery.data) throw new Error('Picks data is still loading.')

      const constructors = formData.getAll('constructors').map((item) => String(item))

      const validated = picksSchema.safeParse({
        p1: String(formData.get('p1') ?? ''),
        p2: String(formData.get('p2') ?? ''),
        p3: String(formData.get('p3') ?? ''),
        constructors,
      })

      if (!validated.success) {
        throw new Error(validated.error.issues[0]?.message ?? 'Invalid pick selection.')
      }

      const captain = String(formData.get('captainDriverId') ?? '')
      if (!captain || ![validated.data.p1, validated.data.p2, validated.data.p3].includes(captain)) {
        throw new Error('Captain must be one of your selected podium drivers.')
      }

      const wildcard = formData.get('wildcard') === 'on'
      const wildcardUsedRaceId = bootstrapQuery.data.wildcardUsedRaceId
      if (wildcard && wildcardUsedRaceId && wildcardUsedRaceId !== bootstrapQuery.data.race.id) {
        throw new Error(`Wildcard already used in ${wildcardUsedRaceId}.`)
      }

      const budgetMode = bootstrapQuery.data.scoringRules.budgetMode
      const driverCostMap = new Map(bootstrapQuery.data.drivers.map((driver) => [driver.id, Number(driver.fantasyCost ?? 25)]))
      const constructorCostMap = new Map(
        bootstrapQuery.data.constructors.map((constructor) => [constructor.id, Number(constructor.fantasyCost ?? 30)]),
      )

      const budgetCost =
        [validated.data.p1, validated.data.p2, validated.data.p3].reduce(
          (sum, driverId) => sum + (driverCostMap.get(driverId) ?? 0),
          0,
        ) +
        validated.data.constructors.reduce(
          (sum, constructorId) => sum + (constructorCostMap.get(constructorId) ?? 0),
          0,
        )

      if (budgetMode.enabled) {
        if (budgetMode.requireSingleConstructor && validated.data.constructors.length !== 1) {
          throw new Error('Budget mode requires exactly one constructor.')
        }

        if (budgetCost > budgetMode.cap) {
          throw new Error(`Budget exceeded: ${budgetCost}/${budgetMode.cap}`)
        }
      }

      const { seasonId, race } = bootstrapQuery.data
      const pickId = `${seasonId}_${race.id}_${activeGroupId}_${user.uid}`

      await setDoc(
        doc(db, 'picks', pickId),
        {
          uid: user.uid,
          groupId: activeGroupId,
          seasonId,
          raceId: race.id,
          podium: {
            p1: validated.data.p1,
            p2: validated.data.p2,
            p3: validated.data.p3,
          },
          captainDriverId: captain,
          wildcard,
          budgetCost,
          constructors: validated.data.constructors,
          submittedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
    },
    onSuccess: async () => {
      setFormError(null)
      await queryClient.invalidateQueries({ queryKey: ['picks-bootstrap', user?.uid, activeGroupId] })
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'Failed to save picks')
    },
  })

  if (bootstrapQuery.isLoading) {
    return (
      <section>
        <h2>Picks</h2>
        <p>Loading picks setup...</p>
      </section>
    )
  }

  if (bootstrapQuery.isError) {
    const errorMessage = (bootstrapQuery.error as Error).message
    if (errorMessage.includes('No season found.')) {
      return (
        <section>
          <h2>Picks</h2>
          <div className="admin-card preseason-empty-state">
            <h3>Preseason Setup Required</h3>
            <p>Create your first season and opening race before submitting picks.</p>
            <p className="notice-text">Use the Admin preseason setup panel to initialize this in one step.</p>
            <Link to="/app/admin" className="inline-link">
              Open Admin Setup
            </Link>
          </div>
        </section>
      )
    }

    return (
      <section>
        <h2>Picks</h2>
        <p className="validation-error">{errorMessage}</p>
      </section>
    )
  }

  const data = bootstrapQuery.data

  if (!data) {
    return (
      <section>
        <h2>Picks</h2>
        <p className="validation-error">Unable to load picks data.</p>
      </section>
    )
  }

  const getDriverOptionsForSlot = (slot: 'p1' | 'p2' | 'p3') => {
    const selectedForSlot = podiumSelections[slot]
    const selectedInOtherSlots = new Set(
      (Object.entries(podiumSelections) as Array<[keyof typeof podiumSelections, string]>)
        .filter(([otherSlot, value]) => otherSlot !== slot && Boolean(value))
        .map(([, value]) => value),
    )

    return data.drivers.filter(
      (driver) => driver.id === selectedForSlot || !selectedInOtherSlots.has(driver.id),
    )
  }

  return (
    <section>
      <h2>Picks</h2>
      {data.seasonMode === 'fallback' ? (
        <p className="notice-text">
          No season is marked active. You are in preseason mode using <strong>{data.seasonName}</strong>.
        </p>
      ) : null}
      <p>
        Group: <strong>{activeGroupId}</strong>
      </p>
      <p>
        Race: <strong>{data.race.name}</strong> (Round {data.race.round})
      </p>
      <div className="race-timeline" aria-label="Race timeline">
        {data.races.map((race) => {
          const raceState = computeRaceLockInfo(race, new Date(nowMs))
          const isActive = race.id === data.race.id
          return (
            <button
              key={race.id}
              type="button"
              className={`race-chip ${isActive ? 'active' : ''}`}
              onClick={() => setSelectedRaceId(race.id)}
              ref={race.id === focusRaceId ? focusChipRef : null}
            >
              <span className="race-chip-round">R{race.round}</span>
              <span className="race-chip-name">{race.name}</span>
              <span className={`race-chip-state ${raceState.isLocked ? 'locked' : 'open'}`}>{raceState.stateLabel}</span>
            </button>
          )
        })}
      </div>
      <label>
        Race Selection
        <select value={data.race.id} onChange={(event) => setSelectedRaceId(event.target.value)}>
          {data.races.map((race) => {
            const raceLock = computeRaceLockInfo(race, new Date(nowMs))
            return (
              <option key={race.id} value={race.id}>
                R{race.round} - {race.name} [{raceLock.stateLabel}]
              </option>
            )
          })}
        </select>
      </label>
      <p>
        Lock:{' '}
        <strong>
          {lockInfo.effectiveLockAt
            ? lockInfo.effectiveLockAt.toLocaleString(undefined, {
                timeZone: data.race?.circuitTimezone ?? undefined,
                timeZoneName: 'short',
              })
            : 'Not configured'}
        </strong>
      </p>
      <p>
        Countdown: <strong>{countdownLabel}</strong>
      </p>
      <p>
        Status: <strong>{lockInfo.stateLabel}</strong>
      </p>

      <div className="admin-card">
        <h3>Safe Pick Hint</h3>
        <p>High-floor drivers: {hints.safeDrivers.map((driver) => driver.name).join(', ') || 'No data yet'}</p>
        <p>Stable constructors: {hints.stableConstructors.map((constructor) => constructor.name).join(', ') || 'No data yet'}</p>
      </div>

      <div className="admin-card">
        <h3>Anti-Dead-Team Auto Suggest</h3>
        {[podiumSelections.p1, podiumSelections.p2, podiumSelections.p3].some((driverId) => hints.deadDriverIds.has(driverId)) ? (
          <>
            <p className="validation-error">One of your selected drivers has high recent DNF risk.</p>
            <p>Suggested swaps: {hints.swapSuggestions.map((driver) => driver.name).join(', ') || 'None'}</p>
          </>
        ) : (
          <p>No critical reliability risks detected in your current podium picks.</p>
        )}
      </div>

      {lockInfo.isLocked ? <p className="validation-error">Picks are locked for this race.</p> : null}

      <form
        key={`${data.seasonId}_${data.race.id}_${activeGroupId}_${user?.uid}`}
        className="picks-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (lockInfo.isLocked) {
            setFormError('Picks are locked for this race.')
            return
          }

          saveMutation.mutate(new FormData(event.currentTarget))
        }}
      >
        <div className="podium-grid">
          <label>
            P1
            <select
              name="p1"
              value={podiumSelections.p1}
              onChange={(event) => {
                const nextValue = event.target.value
                setPodiumSelections((current) => ({ ...current, p1: nextValue }))
              }}
              disabled={lockInfo.isLocked}
            >
              <option value="">Select driver</option>
              {getDriverOptionsForSlot('p1').map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} {driver.code ? `(${driver.code})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            P2
            <select
              name="p2"
              value={podiumSelections.p2}
              onChange={(event) => {
                const nextValue = event.target.value
                setPodiumSelections((current) => ({ ...current, p2: nextValue }))
              }}
              disabled={lockInfo.isLocked}
            >
              <option value="">Select driver</option>
              {getDriverOptionsForSlot('p2').map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} {driver.code ? `(${driver.code})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            P3
            <select
              name="p3"
              value={podiumSelections.p3}
              onChange={(event) => {
                const nextValue = event.target.value
                setPodiumSelections((current) => ({ ...current, p3: nextValue }))
              }}
              disabled={lockInfo.isLocked}
            >
              <option value="">Select driver</option>
              {getDriverOptionsForSlot('p3').map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} {driver.code ? `(${driver.code})` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Captain Driver ({data.scoringRules.captainMultiplier}x)
          <select
            name="captainDriverId"
            value={captainDriverId}
            onChange={(event) => setCaptainDriverId(event.target.value)}
            disabled={lockInfo.isLocked}
          >
            <option value="">Select captain</option>
            {[podiumSelections.p1, podiumSelections.p2, podiumSelections.p3]
              .filter(Boolean)
              .map((driverId) => {
                const driver = data.drivers.find((item) => item.id === driverId)
                if (!driver) return null
                return (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                  </option>
                )
              })}
          </select>
        </label>

        <div>
          <h3>
            Constructors ({data.scoringRules.budgetMode.enabled ? 'budget mode requires 1' : 'optional, choose up to 2'})
          </h3>
          <div className="constructor-grid">
            {data.constructors.map((constructor) => (
              <label key={constructor.id} className="constructor-chip">
                <input
                  type="checkbox"
                  name="constructors"
                  value={constructor.id}
                  defaultChecked={data.existingPick?.constructors.includes(constructor.id)}
                  disabled={lockInfo.isLocked}
                />
                <span>
                  {constructor.name}
                  {constructor.fantasyCost != null ? ` (${constructor.fantasyCost})` : ''}
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="constructor-chip">
          <input
            type="checkbox"
            name="wildcard"
            checked={wildcardEnabled}
            onChange={(event) => setWildcardEnabled(event.target.checked)}
            disabled={lockInfo.isLocked || Boolean(data.wildcardUsedRaceId && data.wildcardUsedRaceId !== data.race.id)}
          />
          <span>
            Wildcard ({data.scoringRules.wildcardMultiplier}x)
            {data.wildcardUsedRaceId
              ? data.wildcardUsedRaceId === data.race.id
                ? ' - active this race'
                : ` - already used at ${data.wildcardUsedRaceId}`
              : ' - available'}
          </span>
        </label>

        {data.scoringRules.budgetMode.enabled ? (
          <p>
            Budget mode: cap <strong>{data.scoringRules.budgetMode.cap}</strong>. Build your team under the cap.
          </p>
        ) : null}

        <button type="submit" disabled={saveMutation.isPending || lockInfo.isLocked}>
          {saveMutation.isPending ? 'Saving...' : 'Save Picks'}
        </button>
      </form>

      {data.existingPick ? <p>Existing picks loaded for this race and group.</p> : null}
      {formError ? <p className="validation-error">{formError}</p> : null}
      {saveMutation.isSuccess ? <p>Picks saved successfully.</p> : null}
    </section>
  )
}

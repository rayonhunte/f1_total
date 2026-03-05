import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { db } from '../lib/firebase'
import { resolveSeasonForClient } from '../lib/season'

type DriverOption = {
  id: string
  name: string
  code?: string
}

type ConstructorOption = {
  id: string
  name: string
}

type RaceInfo = {
  id: string
  name: string
  seasonId: string
  round: number
  raceStartAt?: string
  lockAt?: string
  status?: 'scheduled' | 'in_progress' | 'completed'
}

type PicksBootstrap = {
  seasonId: string
  seasonName: string
  seasonMode: 'active' | 'fallback'
  races: RaceInfo[]
  race: RaceInfo
  drivers: DriverOption[]
  constructors: ConstructorOption[]
  existingPick?: {
    podium: {
      p1: string
      p2: string
      p3: string
    }
    constructors: string[]
  }
}

const picksSchema = z
  .object({
    p1: z.string().min(1, 'Select a driver for P1'),
    p2: z.string().min(1, 'Select a driver for P2'),
    p3: z.string().min(1, 'Select a driver for P3'),
    constructors: z.array(z.string()).min(1, 'Choose at least one constructor').max(2, 'Choose up to two constructors'),
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

function computeRaceLockInfo(race: RaceInfo) {
  const lockAt = toDate(race.lockAt)
  const raceStart = toDate(race.raceStartAt)
  const effectiveLockAt = lockAt ?? raceStart
  const now = new Date()
  const status = race.status ?? 'scheduled'
  const isStatusLocked = status === 'in_progress' || status === 'completed'
  const isTimeLocked = effectiveLockAt ? effectiveLockAt <= now : false
  const isLocked = isStatusLocked || isTimeLocked

  let stateLabel = 'Open'
  if (status === 'completed') stateLabel = 'Completed'
  else if (status === 'in_progress') stateLabel = 'In Progress (Locked)'
  else if (isLocked) stateLabel = 'Locked'

  return {
    effectiveLockAt,
    isLocked,
    status,
    stateLabel,
  }
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
        rawStatus === 'completed' || rawStatus === 'in_progress' ? rawStatus : 'scheduled'

      return {
        id: raceDoc.id,
        name: (data.name as string | undefined) ?? raceDoc.id,
        seasonId,
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
        ...(collectionName === 'drivers' ? { code: data.code as string | undefined } : {}),
      } as T
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchPicksBootstrap(uid: string, groupId: string, selectedRaceId?: string): Promise<PicksBootstrap> {
  const season = await resolveSeasonForClient()
  const seasonId = season.id
  const races = await fetchRacesForSeason(seasonId)
  const preferredRace = selectedRaceId ? races.find((race) => race.id === selectedRaceId) : undefined
  const nextOpenRace = races.find((race) => !computeRaceLockInfo(race).isLocked)
  const race = preferredRace ?? nextOpenRace ?? races[races.length - 1]
  const [drivers, constructors] = await Promise.all([
    fetchOptions<DriverOption>('drivers'),
    fetchOptions<ConstructorOption>('constructors'),
  ])

  const pickId = `${seasonId}_${race.id}_${groupId}_${uid}`
  const pickSnapshot = await getDoc(doc(db, 'picks', pickId))

  return {
    seasonId,
    seasonName: season.name,
    seasonMode: season.mode,
    races,
    race,
    drivers,
    constructors,
    existingPick: pickSnapshot.exists()
      ? {
          podium: pickSnapshot.data().podium as { p1: string; p2: string; p3: string },
          constructors: (pickSnapshot.data().constructors as string[]) ?? [],
        }
      : undefined,
  }
}

export function PicksPage() {
  const { user, activeGroupId } = useAuth()
  const queryClient = useQueryClient()
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedRaceId, setSelectedRaceId] = useState<string>('')
  const focusChipRef = useRef<HTMLButtonElement | null>(null)

  const bootstrapQuery = useQuery({
    queryKey: ['picks-bootstrap', user?.uid, activeGroupId, selectedRaceId],
    queryFn: () => fetchPicksBootstrap(user!.uid, activeGroupId!, selectedRaceId || undefined),
    enabled: Boolean(user?.uid && activeGroupId),
  })

  useEffect(() => {
    const currentRaceId = bootstrapQuery.data?.race.id
    if (!currentRaceId) return
    if (selectedRaceId !== currentRaceId) {
      setSelectedRaceId(currentRaceId)
    }
  }, [bootstrapQuery.data?.race.id, selectedRaceId])

  const lockInfo = useMemo(() => {
    if (!bootstrapQuery.data?.race) {
      return {
        effectiveLockAt: null as Date | null,
        isLocked: false,
        status: 'scheduled' as RaceInfo['status'],
        stateLabel: 'Open',
      }
    }
    return computeRaceLockInfo(bootstrapQuery.data.race)
  }, [bootstrapQuery.data?.race])

  const focusRaceId = useMemo(() => {
    const data = bootstrapQuery.data
    if (!data) return ''
    const openRace = data.races.find((race) => !computeRaceLockInfo(race).isLocked)
    return selectedRaceId || openRace?.id || data.race.id
  }, [bootstrapQuery.data, selectedRaceId])

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
          const raceState = computeRaceLockInfo(race)
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
            const raceLock = computeRaceLockInfo(race)
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
        <strong>{lockInfo.effectiveLockAt ? lockInfo.effectiveLockAt.toLocaleString() : 'Not configured'}</strong>
      </p>
      <p>
        Status: <strong>{lockInfo.stateLabel}</strong>
      </p>

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
            <select name="p1" defaultValue={data.existingPick?.podium.p1 ?? ''} disabled={lockInfo.isLocked}>
              <option value="">Select driver</option>
              {data.drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} {driver.code ? `(${driver.code})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            P2
            <select name="p2" defaultValue={data.existingPick?.podium.p2 ?? ''} disabled={lockInfo.isLocked}>
              <option value="">Select driver</option>
              {data.drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} {driver.code ? `(${driver.code})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            P3
            <select name="p3" defaultValue={data.existingPick?.podium.p3 ?? ''} disabled={lockInfo.isLocked}>
              <option value="">Select driver</option>
              {data.drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} {driver.code ? `(${driver.code})` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <h3>Constructors (choose up to 2)</h3>
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
                <span>{constructor.name}</span>
              </label>
            ))}
          </div>
        </div>

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

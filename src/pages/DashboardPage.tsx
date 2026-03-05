import { useQuery } from '@tanstack/react-query'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { db } from '../lib/firebase'
import { resolveSeasonForClient } from '../lib/season'

type CurrentPickSummary = {
  seasonId: string
  raceId: string
  raceName: string
  podium: {
    p1: string
    p2: string
    p3: string
  }
  constructors: string[]
  updatedAt?: string
}

async function fetchTargetRace(seasonId: string): Promise<{ id: string; name: string; round: number; raceStartAt?: Date }> {
  const racesQuery = query(collection(db, 'races'), where('seasonId', '==', seasonId))
  const racesSnapshot = await getDocs(racesQuery)

  if (racesSnapshot.empty) {
    throw new Error('No races found for the selected season.')
  }

  const now = new Date()
  const races = racesSnapshot.docs
    .map((raceDoc) => {
      const data = raceDoc.data()
      const rawRaceStart = data.raceStartAt
      const raceStartAt = rawRaceStart
        ? typeof rawRaceStart.toDate === 'function'
          ? rawRaceStart.toDate()
          : new Date(String(rawRaceStart))
        : undefined

      return {
        id: raceDoc.id,
        name: (data.name as string | undefined) ?? raceDoc.id,
        round: Number(data.round ?? 0),
        raceStartAt,
      }
    })
    .sort((a, b) => a.round - b.round)

  const upcoming = races.find((race) => (race.raceStartAt ? race.raceStartAt >= now : false))
  return upcoming ?? races[races.length - 1]
}

async function fetchCurrentPick(uid: string, groupId: string): Promise<CurrentPickSummary | null> {
  const season = await resolveSeasonForClient()
  const seasonId = season.id
  const race = await fetchTargetRace(seasonId)
  const pickId = `${seasonId}_${race.id}_${groupId}_${uid}`

  const pickSnap = await getDoc(doc(db, 'picks', pickId))
  if (!pickSnap.exists()) return null

  const data = pickSnap.data()
  const updatedAtRaw = data.updatedAt
  const updatedAt = updatedAtRaw
    ? typeof updatedAtRaw.toDate === 'function'
      ? updatedAtRaw.toDate().toISOString()
      : String(updatedAtRaw)
    : undefined

  return {
    seasonId,
    raceId: race.id,
    raceName: race.name,
    podium: {
      p1: (data.podium?.p1 as string | undefined) ?? '-',
      p2: (data.podium?.p2 as string | undefined) ?? '-',
      p3: (data.podium?.p3 as string | undefined) ?? '-',
    },
    constructors: ((data.constructors as string[] | undefined) ?? []).slice(0, 2),
    updatedAt,
  }
}

export function DashboardPage() {
  const { profile, groups, activeGroupId, user } = useAuth()
  const activeGroup = groups.find((group) => group.id === activeGroupId)
  const activeGroupLabel = activeGroup?.name ?? activeGroupId ?? 'No active group selected'

  const currentPickQuery = useQuery({
    queryKey: ['dashboard-current-pick', user?.uid, activeGroupId],
    queryFn: () => fetchCurrentPick(user!.uid, activeGroupId!),
    enabled: Boolean(user?.uid && activeGroupId),
  })

  return (
    <section>
      <h2>Dashboard</h2>
      <p>Welcome back, {profile?.displayName ?? 'F1 Player'}.</p>
      <p>Current league group: {activeGroupLabel}.</p>
      <p>Track your total points, current rank, and next race lock deadline.</p>

      <div className="dashboard-card">
        <h3>My Current Picks</h3>

        {currentPickQuery.isLoading ? <p>Loading your picks...</p> : null}

        {currentPickQuery.isError ? (
          <p className="validation-error">{(currentPickQuery.error as Error).message}</p>
        ) : null}

        {!currentPickQuery.isLoading && !currentPickQuery.isError && !currentPickQuery.data ? (
          <p>No saved pick yet for your current race and group.</p>
        ) : null}

        {currentPickQuery.data ? (
          <>
            <p>
              Race: <strong>{currentPickQuery.data.raceName}</strong>
            </p>
            <div className="pick-summary-grid">
              <div>
                <span>P1</span>
                <strong>{currentPickQuery.data.podium.p1}</strong>
              </div>
              <div>
                <span>P2</span>
                <strong>{currentPickQuery.data.podium.p2}</strong>
              </div>
              <div>
                <span>P3</span>
                <strong>{currentPickQuery.data.podium.p3}</strong>
              </div>
            </div>
            <p>
              Constructors: <strong>{currentPickQuery.data.constructors.join(', ') || 'None selected'}</strong>
            </p>
            <p>
              Last updated:{' '}
              <strong>
                {currentPickQuery.data.updatedAt
                  ? new Date(currentPickQuery.data.updatedAt).toLocaleString()
                  : 'Unknown'}
              </strong>
            </p>
          </>
        ) : null}

        <Link to="/app/picks" className="secondary-btn card-link-btn">
          Edit Picks
        </Link>
      </div>
    </section>
  )
}

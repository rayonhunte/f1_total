import { useQuery } from '@tanstack/react-query'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { CountryFlag, TeamLogo } from '../components/Branding'
import { getTeamBrand } from '../lib/branding'
import { db, functions } from '../lib/firebase'
import { resolveSeasonForClient } from '../lib/season'

type RaceStatus = 'scheduled' | 'in_progress' | 'completed' | 'results_ingested'

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

type DashboardStanding = {
  uid: string
  displayName: string
  rank: number
  points: number
}

type DashboardMember = {
  uid: string
  displayName: string
  role: 'owner' | 'admin' | 'member'
  status: 'active' | 'pending'
}

type DashboardGroupOverview = {
  standings: DashboardStanding[]
  members: DashboardMember[]
}

type DashboardRaceSummary = {
  seasonId: string
  raceId: string
  raceName: string
  round: number
  raceStartAt?: Date
  lockAt?: Date
  status: RaceStatus
}

function formatCountdown(target: Date | undefined, now: Date): string {
  if (!target) return 'TBD'
  const diff = target.getTime() - now.getTime()
  if (diff <= 0) return 'Locked'

  const totalMinutes = Math.floor(diff / 60000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days.toString().padStart(2, '0')}d ${hours.toString().padStart(2, '0')}h`
  if (hours > 0) return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m`
  return `${minutes.toString().padStart(2, '0')}m`
}

function getRaceState(race: DashboardRaceSummary | null): 'Open' | 'Locked' | 'Completed' {
  if (!race) return 'Locked'
  if (race.status === 'completed' || race.status === 'results_ingested') return 'Completed'
  const lockAt = race.lockAt ?? race.raceStartAt
  if (race.status === 'in_progress') return 'Locked'
  if (lockAt && lockAt <= new Date()) return 'Locked'
  return 'Open'
}

async function fetchTargetRace(seasonId: string): Promise<DashboardRaceSummary> {
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
      const rawLockAt = data.lockAt
      const raceStartAt = rawRaceStart
        ? typeof rawRaceStart.toDate === 'function'
          ? rawRaceStart.toDate()
          : new Date(String(rawRaceStart))
        : undefined
      const lockAt = rawLockAt
        ? typeof rawLockAt.toDate === 'function'
          ? rawLockAt.toDate()
          : new Date(String(rawLockAt))
        : undefined
      const rawStatus = (data.status as string | undefined) ?? 'scheduled'
      const status: RaceStatus =
        rawStatus === 'completed' || rawStatus === 'in_progress' || rawStatus === 'results_ingested'
          ? rawStatus
          : 'scheduled'

      return {
        seasonId,
        raceId: raceDoc.id,
        raceName: (data.name as string | undefined) ?? raceDoc.id,
        round: Number(data.round ?? 0),
        raceStartAt,
        lockAt,
        status,
      } satisfies DashboardRaceSummary
    })
    .sort((a, b) => a.round - b.round)

  const nextOpenRace = races.find((race) => {
    if (race.status === 'completed' || race.status === 'results_ingested') return false
    const effectiveLockAt = race.lockAt ?? race.raceStartAt
    return !effectiveLockAt || effectiveLockAt >= now
  })
  const nextIncompleteRace = races.find((race) => race.status !== 'completed' && race.status !== 'results_ingested')

  return nextOpenRace ?? nextIncompleteRace ?? races[races.length - 1]
}

async function fetchCurrentPick(uid: string, groupId: string): Promise<CurrentPickSummary | null> {
  const season = await resolveSeasonForClient()
  const seasonId = season.id
  const race = await fetchTargetRace(seasonId)
  const pickId = `${seasonId}_${race.raceId}_${groupId}_${uid}`

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
    raceId: race.raceId,
    raceName: race.raceName,
    podium: {
      p1: (data.podium?.p1 as string | undefined) ?? '-',
      p2: (data.podium?.p2 as string | undefined) ?? '-',
      p3: (data.podium?.p3 as string | undefined) ?? '-',
    },
    constructors: ((data.constructors as string[] | undefined) ?? []).slice(0, 2),
    updatedAt,
  }
}

async function fetchDashboardGroupOverview(groupId: string): Promise<DashboardGroupOverview> {
  const season = await resolveSeasonForClient()
  const seasonId = season.id

  const [leaderboardSnap, membersSnap] = await Promise.all([
    getDoc(doc(db, 'leaderboards', `${seasonId}_${groupId}`)),
    getDocs(collection(db, 'groups', groupId, 'members')),
  ])

  const standings = leaderboardSnap.exists()
    ? (((leaderboardSnap.data().entries as Array<Record<string, unknown>> | undefined) ?? [])
        .map((entry) => ({
          uid: String(entry.uid ?? ''),
          displayName: String(entry.displayName ?? entry.uid ?? 'Member'),
          rank: Number(entry.rank ?? 0),
          points: Number(entry.points ?? 0),
        }))
        .filter((entry) => Boolean(entry.uid))
        .sort((a, b) => a.rank - b.rank))
    : []

  const members = membersSnap.docs
    .map((memberDoc) => {
      const data = memberDoc.data()
      return {
        uid: memberDoc.id,
        displayName: String(data.displayName ?? data.email ?? memberDoc.id),
        role: data.role === 'owner' || data.role === 'admin' ? data.role : 'member',
        status: data.status === 'pending' ? 'pending' : 'active',
      } satisfies DashboardMember
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1
      return a.displayName.localeCompare(b.displayName)
    })

  return { standings, members }
}

export function DashboardPage() {
  const { groups, activeGroupId, user } = useAuth()
  const [notificationNotice, setNotificationNotice] = useState<string | null>(null)
  const activeGroup = groups.find((group) => group.id === activeGroupId)
  const activeGroupLabel = activeGroup?.name ?? activeGroupId ?? 'No active group selected'

  const targetRaceQuery = useQuery({
    queryKey: ['dashboard-target-race'],
    queryFn: async () => {
      const season = await resolveSeasonForClient()
      return fetchTargetRace(season.id)
    },
    enabled: Boolean(activeGroupId),
  })

  const currentPickQuery = useQuery({
    queryKey: ['dashboard-current-pick', user?.uid, activeGroupId],
    queryFn: () => fetchCurrentPick(user!.uid, activeGroupId!),
    enabled: Boolean(user?.uid && activeGroupId),
  })

  const notificationPrefsQuery = useQuery({
    queryKey: ['notification-prefs', user?.uid],
    queryFn: async () => {
      const snapshot = await getDoc(doc(db, 'notificationPrefs', user!.uid))
      return snapshot.exists()
        ? (snapshot.data() as { emailEnabled?: boolean; pushEnabled?: boolean; lockReminderMinutesBefore?: number })
        : { emailEnabled: true, pushEnabled: true, lockReminderMinutesBefore: 60 }
    },
    enabled: Boolean(user?.uid),
  })

  const notificationsQuery = useQuery({
    queryKey: ['notifications', user?.uid],
    queryFn: async () => {
      const snapshot = await getDocs(query(collection(db, 'notifications'), where('uid', '==', user!.uid)))
      return snapshot.docs
        .map((row) => {
          const data = row.data()
          return {
            id: row.id,
            title: String(data.title ?? 'Notification'),
            body: String(data.body ?? ''),
            type: String(data.type ?? 'info'),
            createdAt:
              data.createdAt && typeof data.createdAt.toDate === 'function'
                ? data.createdAt.toDate().toISOString()
                : String(data.createdAt ?? ''),
          }
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 6)
    },
    enabled: Boolean(user?.uid),
    refetchInterval: 60_000,
  })

  const groupOverviewQuery = useQuery({
    queryKey: ['dashboard-group-overview', activeGroupId],
    queryFn: () => fetchDashboardGroupOverview(activeGroupId!),
    enabled: Boolean(activeGroupId),
    refetchInterval: 60_000,
  })

  const saveNotificationPreferences = async (next: {
    emailEnabled: boolean
    pushEnabled: boolean
    lockReminderMinutesBefore: number
  }) => {
    const callable = httpsCallable(functions, 'saveNotificationPreferences')
    await callable(next)
    await notificationPrefsQuery.refetch()
    setNotificationNotice('Notification preferences updated.')
  }

  const targetRace = targetRaceQuery.data ?? null
  const raceState = getRaceState(targetRace)
  const activeMembersCount = groupOverviewQuery.data?.members.filter((member) => member.status === 'active').length ?? 0
  const currentStanding = groupOverviewQuery.data?.standings.find((entry) => entry.uid === user?.uid) ?? null
  const now = new Date()
  const countdown = formatCountdown(targetRace?.lockAt ?? targetRace?.raceStartAt, now)

  return (
    <section className="dashboard-page">
      <div className="dashboard-hero-row">
        <div>
          <p className="dashboard-eyebrow">Race Week Snapshot</p>
          <h2>Dashboard</h2>
          <p className="dashboard-intro">
            Monitor your group, the next lock deadline, live standings, and your current picks from one command surface.
          </p>
        </div>

        <div className="dashboard-hero-actions">
          <span className="user-pill dashboard-group-pill">
            <span>Group</span>
            <strong>{activeGroupLabel}</strong>
          </span>
          <Link to="/app/picks" className="landing-btn primary dashboard-cta-link">
            Edit Picks
          </Link>
        </div>
      </div>

      <div className="dashboard-spotlight">
        {targetRaceQuery.isLoading ? <p>Loading next race...</p> : null}
        {targetRaceQuery.isError ? (
          <p className="validation-error">{(targetRaceQuery.error as Error).message}</p>
        ) : null}

        {targetRace ? (
          <>
            <div className="dashboard-spotlight-main">
              <div className="dashboard-race-meta">
                <p className="dashboard-race-kicker">
                  <CountryFlag raceName={targetRace.raceName} size="sm" /> Round {targetRace.round}
                </p>
                <h3>{targetRace.raceName}</h3>
                <p>
                  Lock closes{' '}
                  <strong>
                    {(targetRace.lockAt ?? targetRace.raceStartAt)?.toLocaleString() ?? 'TBD'}
                  </strong>
                </p>
              </div>

              <div className="dashboard-countdown-block">
                <span className="dashboard-countdown-label">Next lock</span>
                <strong className="dashboard-countdown-value">{countdown}</strong>
              </div>
            </div>

            <div className="dashboard-stat-strip">
              <div className="dashboard-stat-card">
                <span>Status</span>
                <strong>{raceState}</strong>
              </div>
              <div className="dashboard-stat-card">
                <span>Your rank</span>
                <strong>{currentStanding ? `#${currentStanding.rank}` : '—'}</strong>
              </div>
              <div className="dashboard-stat-card">
                <span>Active members</span>
                <strong>{activeMembersCount || '—'}</strong>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="dashboard-grid-layout">
        <div className="dashboard-column">
          <article className="dashboard-module">
            <h3>Current Picks</h3>

            {currentPickQuery.isLoading ? <p>Loading your picks...</p> : null}
            {currentPickQuery.isError ? (
              <p className="validation-error">{(currentPickQuery.error as Error).message}</p>
            ) : null}
            {!currentPickQuery.isLoading && !currentPickQuery.isError && !currentPickQuery.data ? (
              <p className="dashboard-empty-state">No saved pick yet for the next race in this group.</p>
            ) : null}

            {currentPickQuery.data ? (
              <>
                <p className="dashboard-module-meta">
                  <CountryFlag raceName={currentPickQuery.data.raceName} size="sm" /> {currentPickQuery.data.raceName}
                </p>
                <div className="dashboard-picks-list">
                  <div className="dashboard-pick-row">
                    <span>P1</span>
                    <strong>{currentPickQuery.data.podium.p1}</strong>
                  </div>
                  <div className="dashboard-pick-row">
                    <span>P2</span>
                    <strong>{currentPickQuery.data.podium.p2}</strong>
                  </div>
                  <div className="dashboard-pick-row">
                    <span>P3</span>
                    <strong>{currentPickQuery.data.podium.p3}</strong>
                  </div>
                </div>
                <div className="dashboard-team-row">
                  {currentPickQuery.data.constructors.length > 0 ? (
                    currentPickQuery.data.constructors.map((constructorId) => (
                      <div key={constructorId} className="dashboard-team-pill">
                        <TeamLogo constructorId={constructorId} name={getTeamBrand(constructorId).label} size="sm" />
                        <span>{getTeamBrand(constructorId).label}</span>
                      </div>
                    ))
                  ) : (
                    <span className="dashboard-empty-state">No constructors selected.</span>
                  )}
                </div>
                <p className="dashboard-module-meta">
                  Updated {currentPickQuery.data.updatedAt ? new Date(currentPickQuery.data.updatedAt).toLocaleString() : 'recently'}
                </p>
              </>
            ) : null}
          </article>

          <article className="dashboard-module">
            <h3>Members</h3>
            {groupOverviewQuery.isLoading ? <p>Loading members...</p> : null}
            {groupOverviewQuery.data ? (
              <ul className="dashboard-members-list">
                {groupOverviewQuery.data.members.slice(0, 8).map((member) => (
                  <li key={member.uid} className="dashboard-member-row">
                    <span>{member.displayName}</span>
                    <span className={`dashboard-role-pill ${member.status === 'pending' ? 'pending' : ''}`}>
                      {member.role}
                      {member.status === 'pending' ? ' • pending' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        </div>

        <div className="dashboard-column">
          <article className="dashboard-module">
            <h3>Current Standings</h3>
            {groupOverviewQuery.isLoading ? <p>Loading standings...</p> : null}
            {groupOverviewQuery.isError ? (
              <p className="validation-error">{(groupOverviewQuery.error as Error).message}</p>
            ) : null}
            {groupOverviewQuery.data && groupOverviewQuery.data.standings.length > 0 ? (
              <ol className="dashboard-standings-list">
                {groupOverviewQuery.data.standings.slice(0, 8).map((entry) => (
                  <li
                    key={entry.uid}
                    className={`dashboard-standing-row ${entry.uid === user?.uid ? 'current-user' : ''}`}
                  >
                    <span className="dashboard-standing-rank">#{entry.rank}</span>
                    <span className="dashboard-standing-name">{entry.displayName}</span>
                    <strong>{entry.points} pts</strong>
                  </li>
                ))}
              </ol>
            ) : null}
            {groupOverviewQuery.data && groupOverviewQuery.data.standings.length === 0 ? (
              <p className="dashboard-empty-state">No standings generated yet for this group.</p>
            ) : null}
          </article>

          <article className="dashboard-module">
            <h3>Activity & Notifications</h3>

            {notificationPrefsQuery.data ? (
              <div className="dashboard-notification-toggles">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() =>
                    void saveNotificationPreferences({
                      emailEnabled: !notificationPrefsQuery.data?.emailEnabled,
                      pushEnabled: Boolean(notificationPrefsQuery.data?.pushEnabled),
                      lockReminderMinutesBefore: Number(notificationPrefsQuery.data?.lockReminderMinutesBefore ?? 60),
                    })
                  }
                >
                  Email {notificationPrefsQuery.data.emailEnabled ? 'On' : 'Off'}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() =>
                    void saveNotificationPreferences({
                      emailEnabled: Boolean(notificationPrefsQuery.data?.emailEnabled),
                      pushEnabled: !notificationPrefsQuery.data?.pushEnabled,
                      lockReminderMinutesBefore: Number(notificationPrefsQuery.data?.lockReminderMinutesBefore ?? 60),
                    })
                  }
                >
                  Push {notificationPrefsQuery.data.pushEnabled ? 'On' : 'Off'}
                </button>
              </div>
            ) : null}

            {notificationNotice ? <p className="notice-text">{notificationNotice}</p> : null}

            {notificationsQuery.data?.length ? (
              <ul className="dashboard-feed-list">
                {notificationsQuery.data.map((item) => (
                  <li key={item.id} className="dashboard-feed-row">
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.body}</p>
                    </div>
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dashboard-empty-state">No recent notifications.</p>
            )}
          </article>
        </div>
      </div>
    </section>
  )
}

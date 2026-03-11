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
  const [notificationNotice, setNotificationNotice] = useState<string | null>(null)
  const activeGroup = groups.find((group) => group.id === activeGroupId)
  const activeGroupLabel = activeGroup?.name ?? activeGroupId ?? 'No active group selected'

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
        .slice(0, 8)
    },
    enabled: Boolean(user?.uid),
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
              Race: <strong><CountryFlag raceName={currentPickQuery.data.raceName} size="sm" /> {currentPickQuery.data.raceName}</strong>
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
              Constructors:{' '}
              {currentPickQuery.data.constructors.length > 0 ? (
                <span className="brand-inline-list">
                  {currentPickQuery.data.constructors.map((constructorId) => (
                    <span key={constructorId} className="brand-inline-item">
                      <TeamLogo constructorId={constructorId} name={getTeamBrand(constructorId).label} size="sm" />
                      <strong>{getTeamBrand(constructorId).label}</strong>
                    </span>
                  ))}
                </span>
              ) : (
                <strong>None selected</strong>
              )}
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

      <div className="dashboard-card">
        <h3>Notifications</h3>
        {notificationPrefsQuery.data ? (
          <div className="pick-summary-grid">
            <div>
              <span>Email</span>
              <button
                type="button"
                onClick={() =>
                  void saveNotificationPreferences({
                    emailEnabled: !notificationPrefsQuery.data?.emailEnabled,
                    pushEnabled: Boolean(notificationPrefsQuery.data?.pushEnabled),
                    lockReminderMinutesBefore: Number(notificationPrefsQuery.data?.lockReminderMinutesBefore ?? 60),
                  })
                }
              >
                {notificationPrefsQuery.data.emailEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div>
              <span>Push</span>
              <button
                type="button"
                onClick={() =>
                  void saveNotificationPreferences({
                    emailEnabled: Boolean(notificationPrefsQuery.data?.emailEnabled),
                    pushEnabled: !notificationPrefsQuery.data?.pushEnabled,
                    lockReminderMinutesBefore: Number(notificationPrefsQuery.data?.lockReminderMinutesBefore ?? 60),
                  })
                }
              >
                {notificationPrefsQuery.data.pushEnabled ? 'On' : 'Off'}
              </button>
            </div>
          </div>
        ) : (
          <p>Loading notification settings...</p>
        )}
        {notificationNotice ? <p className="notice-text">{notificationNotice}</p> : null}

        {notificationsQuery.data?.length ? (
          <ul className="race-score-list">
            {notificationsQuery.data.map((item) => (
              <li key={item.id}>
                <span>{item.title}</span>
                <strong>{new Date(item.createdAt).toLocaleString()}</strong>
                <span>{item.body}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No recent notifications.</p>
        )}
      </div>
    </section>
  )
}

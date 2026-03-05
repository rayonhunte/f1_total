import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { useAuth } from '../auth/useAuth'
import { db } from '../lib/firebase'
import { resolveSeasonForClient } from '../lib/season'

type LeaderboardEntry = {
  uid: string
  displayName: string
  rank: number
  previousRank: number
  rankDelta: number
  points: number
  pointsDelta: number
}

type LeaderboardPayload = {
  seasonId: string
  groupId: string
  groupName?: string
  lastRaceId?: string
  entries: LeaderboardEntry[]
}

type ScorePayload = {
  byRace?: Record<string, number>
}

type LeaderboardViewData = {
  leaderboard: LeaderboardPayload
  myScores: Array<{ raceId: string; points: number }>
}

async function fetchLeaderboardData(uid: string, groupId: string): Promise<LeaderboardViewData> {
  const season = await resolveSeasonForClient()
  const seasonId = season.id
  const leaderboardRef = doc(db, 'leaderboards', `${seasonId}_${groupId}`)
  const leaderboardSnap = await getDoc(leaderboardRef)

  if (!leaderboardSnap.exists()) {
    throw new Error('Leaderboard has not been generated yet for this group.')
  }

  const leaderboardDoc = leaderboardSnap.data() as LeaderboardPayload
  const entries = Array.isArray(leaderboardDoc.entries) ? leaderboardDoc.entries : []

  const scoreRef = doc(db, 'scores', `${seasonId}_${groupId}_${uid}`)
  const scoreSnap = await getDoc(scoreRef)
  const scoreDoc = (scoreSnap.exists() ? scoreSnap.data() : {}) as ScorePayload

  const myScores = Object.entries(scoreDoc.byRace ?? {})
    .map(([raceId, points]) => ({ raceId, points }))
    .sort((a, b) => a.raceId.localeCompare(b.raceId))

  return {
    leaderboard: {
      seasonId,
      groupId,
      groupName: leaderboardDoc.groupName,
      lastRaceId: leaderboardDoc.lastRaceId,
      entries,
    },
    myScores,
  }
}

function MovementBadge({ delta }: { delta: number }) {
  if (delta > 0) return <span className="movement up">+{delta}</span>
  if (delta < 0) return <span className="movement down">{delta}</span>
  return <span className="movement flat">0</span>
}

export function LeaderboardPage() {
  const { user, activeGroupId, groups } = useAuth()
  const activeGroup = groups.find((group) => group.id === activeGroupId)

  const leaderboardQuery = useQuery({
    queryKey: ['leaderboard', user?.uid, activeGroupId],
    queryFn: () => fetchLeaderboardData(user!.uid, activeGroupId!),
    enabled: Boolean(user?.uid && activeGroupId),
    refetchInterval: 60_000,
  })

  if (leaderboardQuery.isLoading) {
    return (
      <section>
        <h2>Leaderboard</h2>
        <p>Loading standings...</p>
      </section>
    )
  }

  if (leaderboardQuery.isError) {
    return (
      <section>
        <h2>Leaderboard</h2>
        <p className="validation-error">{(leaderboardQuery.error as Error).message}</p>
      </section>
    )
  }

  const data = leaderboardQuery.data
  const entries = data?.leaderboard.entries ?? []

  return (
    <section>
      <h2>Leaderboard</h2>
      <p>
        Group: <strong>{activeGroup?.name ?? data?.leaderboard.groupId}</strong>
      </p>
      <p>
        Season: <strong>{data?.leaderboard.seasonId}</strong>
        {data?.leaderboard.lastRaceId ? ` | Last scored race: ${data.leaderboard.lastRaceId}` : ''}
      </p>

      {entries.length === 0 ? (
        <p>No standings yet. Submit picks and run race sync.</p>
      ) : (
        <div className="leaderboard-wrap">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Move</th>
                <th>Total</th>
                <th>Last Race</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isCurrentUser = entry.uid === user?.uid

                return (
                  <tr key={entry.uid} className={isCurrentUser ? 'current-user' : ''}>
                    <td>{entry.rank}</td>
                    <td>{entry.displayName}</td>
                    <td>
                      <MovementBadge delta={entry.rankDelta} />
                    </td>
                    <td>{entry.points}</td>
                    <td>{entry.pointsDelta}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="leaderboard-subtitle">Your race-by-race points</h3>
      {data?.myScores.length ? (
        <ul className="race-score-list">
          {data.myScores.map((row) => (
            <li key={row.raceId}>
              <span>{row.raceId}</span>
              <strong>{row.points}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p>No race score history yet for your account in this group.</p>
      )}
    </section>
  )
}

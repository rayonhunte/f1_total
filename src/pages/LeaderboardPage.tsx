import { useQuery } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { doc, getDoc } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { db, functions } from '../lib/firebase'
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

type WeeklyRecap = {
  raceId: string
  biggestMover: { displayName: string; rankDelta: number } | null
  bestPick: { displayName: string; pointsDelta: number } | null
  worstMiss: { displayName: string; pointsDelta: number } | null
  closestPodiumGuess: { displayName: string; matches: number } | null
}

type SeasonAwards = {
  mostAccurate: { uid: string; score: number } | null
  riskTaker: { uid: string; volatility: number } | null
  comebackOfTheYear: { uid: string; displayName: string; rankDelta: number } | null
}

type HeadToHeadRace = {
  raceId: string
  leftPoints: number
  rightPoints: number
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

async function fetchWeeklyRecap(seasonId: string, groupId: string): Promise<WeeklyRecap | null> {
  const callable = httpsCallable<{ seasonId: string; groupId: string }, WeeklyRecap>(functions, 'getWeeklyRecap')
  try {
    const response = await callable({ seasonId, groupId })
    return response.data
  } catch {
    return null
  }
}

async function fetchSeasonAwards(seasonId: string, groupId: string): Promise<SeasonAwards | null> {
  const callable = httpsCallable<{ seasonId: string; groupId: string }, SeasonAwards>(functions, 'getSeasonAwards')
  try {
    const response = await callable({ seasonId, groupId })
    return response.data
  } catch {
    return null
  }
}

async function fetchHeadToHead(seasonId: string, groupId: string, leftUid: string, rightUid: string): Promise<HeadToHeadRace[]> {
  const [leftScoreSnap, rightScoreSnap] = await Promise.all([
    getDoc(doc(db, 'scores', `${seasonId}_${groupId}_${leftUid}`)),
    getDoc(doc(db, 'scores', `${seasonId}_${groupId}_${rightUid}`)),
  ])

  const leftByRace = ((leftScoreSnap.data()?.byRace ?? {}) as Record<string, number>)
  const rightByRace = ((rightScoreSnap.data()?.byRace ?? {}) as Record<string, number>)
  const raceIds = Array.from(new Set([...Object.keys(leftByRace), ...Object.keys(rightByRace)])).sort((a, b) => a.localeCompare(b))

  return raceIds.map((raceId) => ({
    raceId,
    leftPoints: leftByRace[raceId] ?? 0,
    rightPoints: rightByRace[raceId] ?? 0,
  }))
}

function MovementBadge({ delta }: { delta: number }) {
  if (delta > 0) return <span className="movement up">+{delta}</span>
  if (delta < 0) return <span className="movement down">{delta}</span>
  return <span className="movement flat">0</span>
}

export function LeaderboardPage() {
  const { user, activeGroupId, groups } = useAuth()
  const activeGroup = groups.find((group) => group.id === activeGroupId)
  const [compareUid, setCompareUid] = useState<string>('')

  const leaderboardQuery = useQuery({
    queryKey: ['leaderboard', user?.uid, activeGroupId],
    queryFn: () => fetchLeaderboardData(user!.uid, activeGroupId!),
    enabled: Boolean(user?.uid && activeGroupId),
    refetchInterval: 60_000,
  })

  const weeklyRecapQuery = useQuery({
    queryKey: ['weekly-recap', activeGroupId],
    queryFn: async () => {
      const season = await resolveSeasonForClient()
      return fetchWeeklyRecap(season.id, activeGroupId!)
    },
    enabled: Boolean(activeGroupId),
  })

  const awardsQuery = useQuery({
    queryKey: ['season-awards', activeGroupId],
    queryFn: async () => {
      const season = await resolveSeasonForClient()
      return fetchSeasonAwards(season.id, activeGroupId!)
    },
    enabled: Boolean(activeGroupId),
  })

  const headToHeadQuery = useQuery({
    queryKey: ['head-to-head', activeGroupId, user?.uid, compareUid],
    queryFn: async () => {
      const season = await resolveSeasonForClient()
      return fetchHeadToHead(season.id, activeGroupId!, user!.uid, compareUid)
    },
    enabled: Boolean(activeGroupId && user?.uid && compareUid),
  })

  const data = leaderboardQuery.data
  const entries = useMemo(
    () => data?.leaderboard.entries ?? [],
    [data?.leaderboard.entries],
  )
  const compareOptions = useMemo(
    () => entries.filter((entry) => entry.uid !== user?.uid),
    [entries, user?.uid],
  )

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

      <div className="admin-card">
        <h3>Weekly Recap</h3>
        {weeklyRecapQuery.data ? (
          <>
            <p>Race: {weeklyRecapQuery.data.raceId}</p>
            <p>
              Biggest mover:{' '}
              {weeklyRecapQuery.data.biggestMover
                ? `${weeklyRecapQuery.data.biggestMover.displayName} (${weeklyRecapQuery.data.biggestMover.rankDelta > 0 ? '+' : ''}${weeklyRecapQuery.data.biggestMover.rankDelta})`
                : 'N/A'}
            </p>
            <p>
              Best pick:{' '}
              {weeklyRecapQuery.data.bestPick
                ? `${weeklyRecapQuery.data.bestPick.displayName} (+${weeklyRecapQuery.data.bestPick.pointsDelta})`
                : 'N/A'}
            </p>
            <p>
              Worst miss:{' '}
              {weeklyRecapQuery.data.worstMiss
                ? `${weeklyRecapQuery.data.worstMiss.displayName} (${weeklyRecapQuery.data.worstMiss.pointsDelta})`
                : 'N/A'}
            </p>
            <p>
              Closest podium guess:{' '}
              {weeklyRecapQuery.data.closestPodiumGuess
                ? `${weeklyRecapQuery.data.closestPodiumGuess.displayName} (${weeklyRecapQuery.data.closestPodiumGuess.matches}/3)`
                : 'N/A'}
            </p>
          </>
        ) : (
          <p>Recap will appear after scoring runs.</p>
        )}
      </div>

      <div className="admin-card">
        <h3>Season Awards</h3>
        {awardsQuery.data ? (
          <>
            <p>
              Most accurate:{' '}
              {awardsQuery.data.mostAccurate
                ? `${uidToDisplayName[awardsQuery.data.mostAccurate.uid] ?? awardsQuery.data.mostAccurate.uid} (${awardsQuery.data.mostAccurate.score})`
                : 'N/A'}
            </p>
            <p>
              Risk taker:{' '}
              {awardsQuery.data.riskTaker
                ? `${uidToDisplayName[awardsQuery.data.riskTaker.uid] ?? awardsQuery.data.riskTaker.uid} (volatility ${awardsQuery.data.riskTaker.volatility})`
                : 'N/A'}
            </p>
            <p>
              Comeback of the year:{' '}
              {awardsQuery.data.comebackOfTheYear
                ? `${awardsQuery.data.comebackOfTheYear.displayName} (+${awardsQuery.data.comebackOfTheYear.rankDelta})`
                : 'N/A'}
            </p>
          </>
        ) : (
          <p>Awards are generated once race data and scores exist.</p>
        )}
      </div>

      <div className="admin-card">
        <h3>Head-to-Head + Pick History</h3>
        <label>
          Compare against member
          <select value={compareUid} onChange={(event) => setCompareUid(event.target.value)}>
            <option value="">Select member</option>
            {compareOptions.map((entry) => (
              <option key={entry.uid} value={entry.uid}>
                {entry.displayName}
              </option>
            ))}
          </select>
        </label>

        {headToHeadQuery.data?.length ? (
          <div className="leaderboard-wrap">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Race</th>
                  <th>You</th>
                  <th>Opponent</th>
                  <th>Diff</th>
                </tr>
              </thead>
              <tbody>
                {headToHeadQuery.data.map((row) => (
                  <tr key={row.raceId}>
                    <td>{row.raceId}</td>
                    <td>{row.leftPoints}</td>
                    <td>{row.rightPoints}</td>
                    <td>{row.leftPoints - row.rightPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : compareUid ? (
          <p>No shared race history yet with this member.</p>
        ) : (
          <p>Select a member to compare race-by-race points.</p>
        )}
      </div>

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

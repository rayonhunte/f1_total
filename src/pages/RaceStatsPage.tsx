import { collection, getDocs, getDoc, doc, query, where } from 'firebase/firestore'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { CountryFlag, TeamLogo } from '../components/Branding'
import { db } from '../lib/firebase'
import { resolveSeasonForClient } from '../lib/season'

type RaceInfo = {
  id: string
  name: string
  round: number
}

type DriverOption = { id: string; name: string }
type ConstructorOption = { id: string; name: string }

type ResultDriverRow = {
  driverId: string
  constructorId: string
  points: number
  dnf: boolean
}

type RaceResultData = {
  raceId: string
  round: number
  raceName?: string
  podium: [string, string, string]
  driverResults: ResultDriverRow[]
  driverMovement?: Record<string, number>
}

type StatsBootstrap = {
  seasonId: string
  seasonName: string
  races: RaceInfo[]
  results: RaceResultData[]
  drivers: DriverOption[]
  constructors: ConstructorOption[]
  scoringRules: {
    podiumPoints: { p1: number; p2: number; p3: number }
    driverGain: number
    dnfPenalty: { enabled: boolean; value: number }
  }
}

function safeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function fetchRacesForSeason(seasonId: string): Promise<RaceInfo[]> {
  const racesSnapshot = await getDocs(query(collection(db, 'races'), where('seasonId', '==', seasonId)))
  if (racesSnapshot.empty) return []
  return racesSnapshot.docs
    .map((raceDoc) => {
      const data = raceDoc.data()
      return {
        id: raceDoc.id,
        name: (data.name as string | undefined) ?? raceDoc.id,
        round: Number(data.round ?? 0),
      }
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
      return { id: item.id, name: (data.name as string | undefined) ?? item.id } as T
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchStatsBootstrap(): Promise<StatsBootstrap> {
  const season = await resolveSeasonForClient()
  const seasonId = season.id
  const seasonSnap = await getDoc(doc(db, 'seasons', seasonId))
  const seasonData = seasonSnap.data() ?? {}
  const rawScoring = (seasonData.scoringRules && typeof seasonData.scoringRules === 'object'
    ? seasonData.scoringRules
    : {}) as Record<string, unknown>
  const rawPodium = (rawScoring.podiumPoints && typeof rawScoring.podiumPoints === 'object'
    ? rawScoring.podiumPoints
    : {}) as Record<string, unknown>
  const rawStandings = (rawScoring.standingsMovement && typeof rawScoring.standingsMovement === 'object'
    ? rawScoring.standingsMovement
    : {}) as Record<string, unknown>
  const rawDnf = (rawScoring.dnfPenalty && typeof rawScoring.dnfPenalty === 'object'
    ? rawScoring.dnfPenalty
    : {}) as Record<string, unknown>

  const scoringRules = {
    podiumPoints: {
      p1: safeNumber(rawPodium.p1, 25),
      p2: safeNumber(rawPodium.p2, 18),
      p3: safeNumber(rawPodium.p3, 15),
    },
    driverGain: safeNumber(rawStandings.driverGain, 1),
    dnfPenalty: {
      enabled: rawDnf.enabled === true,
      value: safeNumber(rawDnf.value, 0),
    },
  }

  const [races, resultsSnapshot, drivers, constructors] = await Promise.all([
    fetchRacesForSeason(seasonId),
    getDocs(query(collection(db, 'results'), where('seasonId', '==', seasonId))),
    fetchOptions<DriverOption>('drivers'),
    fetchOptions<ConstructorOption>('constructors'),
  ])

  const results: RaceResultData[] = resultsSnapshot.docs
    .map((resDoc) => {
      const data = resDoc.data()
      return {
        raceId: resDoc.id,
        round: Number(data.round ?? 0),
        raceName: data.raceName as string | undefined,
        podium: (data.podium as [string, string, string]) ?? ['', '', ''],
        driverResults: (data.driverResults as ResultDriverRow[]) ?? [],
        driverMovement: (data.driverMovement as Record<string, number> | undefined) ?? {},
      }
    })
    .sort((a, b) => a.round - b.round)

  return {
    seasonId,
    seasonName: season.name,
    races,
    results,
    drivers,
    constructors,
    scoringRules,
  }
}

function potentialPointsForDriver(
  driverId: string,
  result: RaceResultData,
  rules: StatsBootstrap['scoringRules'],
): number {
  const [p1, p2, p3] = result.podium
  let pts = 0
  if (driverId === p1) pts += rules.podiumPoints.p1
  else if (driverId === p2) pts += rules.podiumPoints.p2
  else if (driverId === p3) pts += rules.podiumPoints.p3

  const movement = result.driverMovement?.[driverId] ?? 0
  pts += Math.max(0, movement) * rules.driverGain

  if (rules.dnfPenalty.enabled && rules.dnfPenalty.value > 0) {
    const row = result.driverResults.find((r) => r.driverId === driverId)
    if (row?.dnf) pts -= rules.dnfPenalty.value
  }
  return pts
}

type StatsTab = 'race' | 'drivers'

export function RaceStatsPage() {
  const { activeGroupId } = useAuth()
  const [statsTab, setStatsTab] = useState<StatsTab>('race')
  const [selectedRaceId, setSelectedRaceId] = useState<string>('')

  const bootstrapQuery = useQuery({
    queryKey: ['race-stats-bootstrap', activeGroupId],
    queryFn: fetchStatsBootstrap,
    enabled: Boolean(activeGroupId),
  })

  const { results, drivers, constructors, scoringRules } = bootstrapQuery.data ?? {}
  const driverById = useMemo(() => new Map(drivers?.map((d) => [d.id, d])), [drivers])
  const constructorById = useMemo(() => new Map(constructors?.map((c) => [c.id, c])), [constructors])

  const selectedResult = useMemo(() => {
    if (!results?.length) return null
    const id = selectedRaceId || results[results.length - 1]?.raceId
    return results.find((r) => r.raceId === id) ?? results[results.length - 1] ?? null
  }, [results, selectedRaceId])

  const driverTotals = useMemo(() => {
    if (!results?.length || !scoringRules) return new Map<string, { races: number; podiums: number; f1Points: number; potentialPoints: number }>()
    const map = new Map<string, { races: number; podiums: number; f1Points: number; potentialPoints: number }>()
    for (const result of results) {
      for (const row of result.driverResults) {
        const cur = map.get(row.driverId) ?? { races: 0, podiums: 0, f1Points: 0, potentialPoints: 0 }
        cur.races += 1
        if (result.podium.includes(row.driverId)) cur.podiums += 1
        cur.f1Points += row.points ?? 0
        cur.potentialPoints += potentialPointsForDriver(row.driverId, result, scoringRules)
        map.set(row.driverId, cur)
      }
    }
    return map
  }, [results, scoringRules])

  if (bootstrapQuery.isLoading) {
    return (
      <section>
        <h2>Race &amp; Driver Stats</h2>
        <p>Loading stats...</p>
      </section>
    )
  }

  if (bootstrapQuery.isError) {
    return (
      <section>
        <h2>Race &amp; Driver Stats</h2>
        <p className="validation-error">{(bootstrapQuery.error as Error).message}</p>
      </section>
    )
  }

  if (!bootstrapQuery.data) {
    return (
      <section>
        <h2>Race &amp; Driver Stats</h2>
        <p>No season data.</p>
      </section>
    )
  }

  const data = bootstrapQuery.data
  const selectedRaceName =
    selectedResult?.raceName ?? data.races.find((r) => r.id === selectedResult?.raceId)?.name ?? selectedResult?.raceId ?? ''

  return (
    <section className="stats-page">
      <h2>Race &amp; Driver Stats</h2>
      <p>
        View race results, driver stats, and <strong>potential fantasy points</strong> if you had picked each driver
        (podium match + movement; captain multiplier not applied).
      </p>

      {data.results.length === 0 ? (
        <p>No race results yet. Results appear here after races are scored.</p>
      ) : (
        <>
          <div className="admin-tabs" role="tablist" aria-label="Stats sections">
            <button
              type="button"
              role="tab"
              aria-selected={statsTab === 'race'}
              className={statsTab === 'race' ? 'admin-tab-btn active' : 'admin-tab-btn'}
              onClick={() => setStatsTab('race')}
            >
              By race
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={statsTab === 'drivers'}
              className={statsTab === 'drivers' ? 'admin-tab-btn active' : 'admin-tab-btn'}
              onClick={() => setStatsTab('drivers')}
            >
              Driver stats
            </button>
          </div>

          <div className="admin-tab-panel">
            {statsTab === 'race' && (
              <>
                <div className="admin-card stats-race-block">
                  <h3>Select race</h3>
                  <label className="stats-select-label">
                    Race{' '}
                    <select
                      className="stats-select"
                      value={(selectedRaceId || selectedResult?.raceId) ?? ''}
                      onChange={(e) => setSelectedRaceId(e.target.value)}
                    >
                      {data.results.map((r) => (
                        <option key={r.raceId} value={r.raceId}>
                          R{r.round} – {r.raceName ?? data.races.find((x) => x.id === r.raceId)?.name ?? r.raceId}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {selectedResult && (
                  <div className="admin-card stats-driver-block">
                    <h3>
                      <CountryFlag raceName={selectedRaceName} size="sm" /> {selectedRaceName}
                    </h3>
                    <div className="stats-table-wrap">
                      <table className="stats-table">
                      <thead>
                        <tr>
                          <th>Pos</th>
                          <th>Driver</th>
                          <th>Constructor</th>
                          <th>F1 Pts</th>
                          <th>DNF</th>
                          <th>Potential pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedResult.driverResults.map((row, idx) => {
                          const potential = potentialPointsForDriver(row.driverId, selectedResult, data.scoringRules)
                          return (
                            <tr key={row.driverId}>
                              <td>{idx + 1}</td>
                              <td>{driverById.get(row.driverId)?.name ?? row.driverId}</td>
                              <td>
                                <span className="brand-inline-item">
                                  <TeamLogo
                                    constructorId={row.constructorId}
                                    name={constructorById.get(row.constructorId)?.name ?? row.constructorId}
                                    size="sm"
                                  />
                                  {constructorById.get(row.constructorId)?.name ?? row.constructorId}
                                </span>
                              </td>
                              <td>{row.points}</td>
                              <td>{row.dnf ? 'Yes' : '—'}</td>
                              <td><strong>{potential}</strong></td>
                            </tr>
                          )
                        })}
                      </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {statsTab === 'drivers' && (
              <div className="admin-card">
                <h3>Driver stats (season)</h3>
                <p>Totals across all scored races. Potential pts = fantasy points if you had picked that driver each race.</p>
                <div className="stats-table-wrap">
                  <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th>Races</th>
                      <th>Podiums</th>
                      <th>F1 Pts</th>
                      <th>Potential pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(driverTotals.entries())
                      .sort((a, b) => (b[1].potentialPoints - a[1].potentialPoints))
                      .map(([driverId, tot]) => (
                        <tr key={driverId}>
                          <td>{driverById.get(driverId)?.name ?? driverId}</td>
                          <td>{tot.races}</td>
                          <td>{tot.podiums}</td>
                          <td>{tot.f1Points}</td>
                          <td><strong>{tot.potentialPoints}</strong></td>
                        </tr>
                      ))}
                  </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

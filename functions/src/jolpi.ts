const JOLPI_BASE = 'https://api.jolpi.ca/ergast/f1'

type JolpiResponse<T> = {
  MRData: T
}

type RaceResultEntry = {
  position: string
  points: string
  status: string
  Driver: {
    driverId: string
    code?: string
  }
  Constructor: {
    constructorId: string
  }
}

type RaceTable = {
  RaceTable: {
    Races: Array<{
      season?: string
      round?: string
      raceName: string
      date?: string
      time?: string
      Circuit?: {
        circuitId?: string
        circuitName?: string
        Location?: {
          lat?: string
          long?: string
          locality?: string
          country?: string
        }
      }
      Results?: RaceResultEntry[]
    }>
  }
}

type DriverStanding = {
  position: string
  Driver: {
    driverId: string
  }
}

type ConstructorStanding = {
  position: string
  Constructor: {
    constructorId: string
  }
}

type DriverStandingsTable = {
  StandingsTable: {
    StandingsLists: Array<{
      DriverStandings: DriverStanding[]
    }>
  }
}

type ConstructorStandingsTable = {
  StandingsTable: {
    StandingsLists: Array<{
      ConstructorStandings: ConstructorStanding[]
    }>
  }
}

type DriverEntry = {
  driverId: string
  code?: string
  givenName?: string
  familyName?: string
}

type ConstructorEntry = {
  constructorId: string
  name?: string
}

type DriverTable = {
  DriverTable: {
    Drivers: DriverEntry[]
  }
}

type ConstructorTable = {
  ConstructorTable: {
    Constructors: ConstructorEntry[]
  }
}

export type LiveDriver = {
  id: string
  name: string
  code?: string
}

export type LiveConstructor = {
  id: string
  name: string
}

export type SeasonRaceSchedule = {
  seasonYear: number
  round: number
  raceName: string
  raceStartAt?: string
  circuitId?: string
  circuitName?: string
  latitude?: number
  longitude?: number
  locality?: string
  country?: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Jolpi request failed (${response.status}): ${url}`)
  }

  return (await response.json()) as T
}

export async function fetchRaceResults(seasonYear: number, round: number) {
  const url = `${JOLPI_BASE}/${seasonYear}/${round}/results.json`
  const payload = await fetchJson<JolpiResponse<RaceTable>>(url)
  return payload.MRData.RaceTable.Races[0]
}

export async function fetchSeasonSchedule(seasonYear: number): Promise<SeasonRaceSchedule[]> {
  const url = `${JOLPI_BASE}/${seasonYear}.json`
  const payload = await fetchJson<JolpiResponse<RaceTable>>(url)

  return (payload.MRData.RaceTable.Races ?? [])
    .map((race) => {
      const round = Number(race.round ?? 0)
      const date = typeof race.date === 'string' ? race.date.trim() : ''
      const time = typeof race.time === 'string' ? race.time.trim() : ''
      const raceStartAt = date ? `${date}T${time || '00:00:00Z'}` : undefined

      return {
        seasonYear,
        round,
        raceName: race.raceName,
        raceStartAt,
        circuitId: race.Circuit?.circuitId,
        circuitName: race.Circuit?.circuitName,
        latitude: Number(race.Circuit?.Location?.lat ?? NaN),
        longitude: Number(race.Circuit?.Location?.long ?? NaN),
        locality: race.Circuit?.Location?.locality,
        country: race.Circuit?.Location?.country,
      } satisfies SeasonRaceSchedule
    })
    .map((race) => ({
      ...race,
      latitude: Number.isFinite(race.latitude) ? race.latitude : undefined,
      longitude: Number.isFinite(race.longitude) ? race.longitude : undefined,
    }))
    .filter((race) => Number.isInteger(race.round) && race.round > 0 && Boolean(race.raceName))
    .sort((a, b) => a.round - b.round)
}

export async function fetchDriverStandings(seasonYear: number, round: number) {
  const url = `${JOLPI_BASE}/${seasonYear}/${round}/driverStandings.json`
  const payload = await fetchJson<JolpiResponse<DriverStandingsTable>>(url)
  return payload.MRData.StandingsTable.StandingsLists[0]?.DriverStandings ?? []
}

export async function fetchConstructorStandings(seasonYear: number, round: number) {
  const url = `${JOLPI_BASE}/${seasonYear}/${round}/constructorStandings.json`
  const payload = await fetchJson<JolpiResponse<ConstructorStandingsTable>>(url)
  return payload.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings ?? []
}

export async function fetchSeasonDrivers(seasonYear: number): Promise<LiveDriver[]> {
  const url = `${JOLPI_BASE}/${seasonYear}/drivers.json?limit=100`
  const payload = await fetchJson<JolpiResponse<DriverTable>>(url)

  return (payload.MRData.DriverTable.Drivers ?? [])
    .map((driver) => {
      const name = `${driver.givenName ?? ''} ${driver.familyName ?? ''}`.trim()
      return {
        id: driver.driverId,
        name: name || driver.driverId,
        code: driver.code,
      } satisfies LiveDriver
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function fetchSeasonConstructors(seasonYear: number): Promise<LiveConstructor[]> {
  const url = `${JOLPI_BASE}/${seasonYear}/constructors.json?limit=100`
  const payload = await fetchJson<JolpiResponse<ConstructorTable>>(url)

  return (payload.MRData.ConstructorTable.Constructors ?? [])
    .map((constructor) => ({
      id: constructor.constructorId,
      name: constructor.name || constructor.constructorId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function isDnfStatus(status: string): boolean {
  const normalized = status.trim()

  if (!normalized) return false
  if (/^Finished$/i.test(normalized)) return false
  if (/^Lapped$/i.test(normalized)) return false
  if (/^\+\d+\s+Laps?$/i.test(normalized)) return false
  if (/^\+\d+(?::\d{1,2})?\.\d+$/i.test(normalized)) return false
  return true
}

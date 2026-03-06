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
      raceName: string
      Results: RaceResultEntry[]
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
  if (status === 'Finished') return false
  if (/^\+\d+ Laps?$/i.test(status)) return false
  if (/^\+\d+ Lap$/i.test(status)) return false
  return true
}

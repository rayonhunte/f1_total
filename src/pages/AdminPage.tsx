import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { db, functions } from '../lib/firebase'

type MemberRow = {
  uid: string
  displayName?: string
  email?: string
  role: 'owner' | 'admin' | 'member'
  status: 'active' | 'pending'
}

type GroupAdminData = {
  groupName: string
  joinCode: string
  ownerUid: string
  members: MemberRow[]
}

type PreseasonStatus = {
  seasonCount: number
  activeSeasonCount: number
  selectedSeasonId: string | null
  selectedSeasonName: string | null
  selectedSeasonMode: 'active' | 'fallback' | 'none'
  raceCount: number
  driversCount: number
  constructorsCount: number
}

type InitializeSeasonResponse = {
  seasonId: string
  raceId: string
  activated: boolean
  seasonCreated: boolean
  rosterSeeded: {
    constructorsSeeded: number
    driversSeeded: number
  }
}

type InitializeSeasonRequest = {
  seasonId: string
  seasonName: string
  seasonYear: number
  activateSeason: boolean
  firstRaceName: string
  firstRaceRound: number
  raceStartAt: string
  lockAt: string
  seedDefaultRoster: boolean
}

type ConstructorOption = {
  id: string
  name: string
}

type ScoringRulesForm = {
  podiumPoints: {
    p1: number
    p2: number
    p3: number
  }
  constructorPointsMode: 'official' | 'custom'
  constructorPointsCustom: Record<string, number>
  constructorPointsMultiplier: number
  standingsMovement: {
    constructorGain: number
    driverGain: number
  }
  dnfPenalty: {
    enabled: boolean
    value: number
  }
  captainMultiplier: number
  wildcardMultiplier: number
  budgetMode: {
    enabled: boolean
    cap: number
    requireSingleConstructor: boolean
  }
}

type ScoringConfig = {
  seasonId: string
  seasonName: string
  scoringRules: ScoringRulesForm
  constructors: ConstructorOption[]
}

type UpdateSeasonScoringRulesRequest = {
  seasonId?: string
  scoringRules: ScoringRulesForm
}

type UpdateSeasonScoringRulesResponse = {
  seasonId: string
  scoringRules: ScoringRulesForm
}

type SimulateSeasonScoringResponse = {
  seasonId: string
  sampleSize: number
  topGainers: Array<{ groupId: string; uid: string; currentTotal: number; simulatedTotal: number; delta: number }>
  topLosers: Array<{ groupId: string; uid: string; currentTotal: number; simulatedTotal: number; delta: number }>
}

type AdminTabKey = 'invite' | 'preseason' | 'scoring' | 'simulation' | 'members'

const DEFAULT_SCORING_RULES: ScoringRulesForm = {
  podiumPoints: {
    p1: 25,
    p2: 18,
    p3: 15,
  },
  constructorPointsMode: 'official',
  constructorPointsCustom: {},
  constructorPointsMultiplier: 1,
  standingsMovement: {
    constructorGain: 2,
    driverGain: 1,
  },
  dnfPenalty: {
    enabled: false,
    value: 0,
  },
  captainMultiplier: 1.5,
  wildcardMultiplier: 2,
  budgetMode: {
    enabled: false,
    cap: 100,
    requireSingleConstructor: true,
  },
}

function safeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toLocalInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function toRankedSeasonList(snapshot: QueryDocumentSnapshot<DocumentData>[]) {
  return snapshot
    .map((seasonDoc) => {
      const data = seasonDoc.data()
      const yearRaw = data.year
      const year = typeof yearRaw === 'number' ? yearRaw : Number(yearRaw ?? 0)
      const createdAtRaw = data.createdAt
      const createdAtMillis =
        createdAtRaw && typeof createdAtRaw.toDate === 'function'
          ? createdAtRaw.toDate().getTime()
          : Number(new Date(String(createdAtRaw ?? '')).getTime() || 0)

      return {
        id: seasonDoc.id,
        name: (data.name as string | undefined) ?? seasonDoc.id,
        year: Number.isFinite(year) ? year : 0,
        isActive: data.isActive === true,
        createdAtMillis: Number.isFinite(createdAtMillis) ? createdAtMillis : 0,
      }
    })
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
      if (a.year !== b.year) return b.year - a.year
      if (a.createdAtMillis !== b.createdAtMillis) return b.createdAtMillis - a.createdAtMillis
      return b.id.localeCompare(a.id)
    })
}

async function fetchPreseasonStatus(): Promise<PreseasonStatus> {
  const [seasonsSnap, driversSnap, constructorsSnap] = await Promise.all([
    getDocs(collection(db, 'seasons')),
    getDocs(collection(db, 'drivers')),
    getDocs(collection(db, 'constructors')),
  ])

  if (seasonsSnap.empty) {
    return {
      seasonCount: 0,
      activeSeasonCount: 0,
      selectedSeasonId: null,
      selectedSeasonName: null,
      selectedSeasonMode: 'none',
      raceCount: 0,
      driversCount: driversSnap.size,
      constructorsCount: constructorsSnap.size,
    }
  }

  const rankedSeasons = toRankedSeasonList(seasonsSnap.docs)
  const selected = rankedSeasons[0]
  const racesSnap = await getDocs(query(collection(db, 'races'), where('seasonId', '==', selected.id)))

  return {
    seasonCount: seasonsSnap.size,
    activeSeasonCount: rankedSeasons.filter((season) => season.isActive).length,
    selectedSeasonId: selected.id,
    selectedSeasonName: selected.name,
    selectedSeasonMode: selected.isActive ? 'active' : 'fallback',
    raceCount: racesSnap.size,
    driversCount: driversSnap.size,
    constructorsCount: constructorsSnap.size,
  }
}

async function fetchScoringConfig(seasonId: string): Promise<ScoringConfig> {
  const [seasonSnap, constructorsSnap] = await Promise.all([
    getDoc(doc(db, 'seasons', seasonId)),
    getDocs(collection(db, 'constructors')),
  ])

  if (!seasonSnap.exists()) {
    throw new Error(`Season ${seasonId} not found.`)
  }

  const seasonData = seasonSnap.data()
  const rawScoring =
    seasonData.scoringRules && typeof seasonData.scoringRules === 'object'
      ? (seasonData.scoringRules as Record<string, unknown>)
      : {}

  const rawPodium =
    rawScoring.podiumPoints && typeof rawScoring.podiumPoints === 'object'
      ? (rawScoring.podiumPoints as Record<string, unknown>)
      : {}

  const rawStandings =
    rawScoring.standingsMovement && typeof rawScoring.standingsMovement === 'object'
      ? (rawScoring.standingsMovement as Record<string, unknown>)
      : {}

  const rawDnf =
    rawScoring.dnfPenalty && typeof rawScoring.dnfPenalty === 'object'
      ? (rawScoring.dnfPenalty as Record<string, unknown>)
      : {}

  const rawBudget =
    rawScoring.budgetMode && typeof rawScoring.budgetMode === 'object'
      ? (rawScoring.budgetMode as Record<string, unknown>)
      : {}

  const constructors = constructorsSnap.docs
    .map((constructorDoc) => {
      const data = constructorDoc.data()
      return {
        id: constructorDoc.id,
        name: (data.name as string | undefined) ?? constructorDoc.id,
      } satisfies ConstructorOption
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const customMapRaw =
    rawScoring.constructorPointsCustom && typeof rawScoring.constructorPointsCustom === 'object'
      ? (rawScoring.constructorPointsCustom as Record<string, unknown>)
      : {}

  const scoringRules: ScoringRulesForm = {
    podiumPoints: {
      p1: safeNumber(rawPodium.p1, DEFAULT_SCORING_RULES.podiumPoints.p1),
      p2: safeNumber(rawPodium.p2, DEFAULT_SCORING_RULES.podiumPoints.p2),
      p3: safeNumber(rawPodium.p3, DEFAULT_SCORING_RULES.podiumPoints.p3),
    },
    constructorPointsMode:
      rawScoring.constructorPointsMode === 'custom'
        ? 'custom'
        : DEFAULT_SCORING_RULES.constructorPointsMode,
    constructorPointsCustom: Object.entries(customMapRaw).reduce<Record<string, number>>(
      (acc, [constructorId, value]) => {
        acc[constructorId] = safeNumber(value, 0)
        return acc
      },
      {},
    ),
    constructorPointsMultiplier: safeNumber(
      rawScoring.constructorPointsMultiplier,
      DEFAULT_SCORING_RULES.constructorPointsMultiplier,
    ),
    standingsMovement: {
      constructorGain: safeNumber(
        rawStandings.constructorGain,
        DEFAULT_SCORING_RULES.standingsMovement.constructorGain,
      ),
      driverGain: safeNumber(rawStandings.driverGain, DEFAULT_SCORING_RULES.standingsMovement.driverGain),
    },
    dnfPenalty: {
      enabled: rawDnf.enabled === true,
      value: safeNumber(rawDnf.value, DEFAULT_SCORING_RULES.dnfPenalty.value),
    },
    captainMultiplier: safeNumber(
      rawScoring.captainMultiplier,
      DEFAULT_SCORING_RULES.captainMultiplier,
    ),
    wildcardMultiplier: safeNumber(
      rawScoring.wildcardMultiplier,
      DEFAULT_SCORING_RULES.wildcardMultiplier,
    ),
    budgetMode: {
      enabled: rawBudget.enabled === true,
      cap: safeNumber(rawBudget.cap, DEFAULT_SCORING_RULES.budgetMode.cap),
      requireSingleConstructor: rawBudget.requireSingleConstructor !== false,
    },
  }

  return {
    seasonId,
    seasonName: (seasonData.name as string | undefined) ?? seasonId,
    scoringRules,
    constructors,
  }
}

async function fetchGroupAdminData(groupId: string): Promise<GroupAdminData> {
  const groupSnap = await getDoc(doc(db, 'groups', groupId))
  if (!groupSnap.exists()) throw new Error('Group not found.')

  const membersSnap = await getDocs(collection(db, 'groups', groupId, 'members'))
  const members = membersSnap.docs
    .map((item) => {
      const data = item.data()
      const role = data.role === 'owner' || data.role === 'admin' ? data.role : 'member'
      const status = data.status === 'pending' ? 'pending' : 'active'
      return {
        uid: item.id,
        displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
        email: typeof data.email === 'string' ? data.email : undefined,
        role,
        status,
      } satisfies MemberRow
    })
    .sort((a, b) => {
      const aLabel = (a.displayName || a.email || a.uid).toLowerCase()
      const bLabel = (b.displayName || b.email || b.uid).toLowerCase()
      return aLabel.localeCompare(bLabel)
    })

  const groupData = groupSnap.data()

  return {
    groupName: (groupData.name as string | undefined) ?? groupId,
    joinCode: (groupData.joinCode as string | undefined) ?? '',
    ownerUid: (groupData.ownerUid as string | undefined) ?? '',
    members,
  }
}

export function AdminPage() {
  const { activeGroupId, currentGroupRole, approveMember, setMemberRole, refreshGroups, profile } = useAuth()
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)
  const [setupNotice, setSetupNotice] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<AdminTabKey>('invite')
  const now = new Date()
  const defaultStart = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const currentYear = now.getFullYear()
  const [seasonYear, setSeasonYear] = useState(String(currentYear))
  const [seasonId, setSeasonId] = useState(String(currentYear))
  const [seasonName, setSeasonName] = useState(`${currentYear} Season`)
  const [firstRaceName, setFirstRaceName] = useState('Season Opener')
  const [firstRaceRound, setFirstRaceRound] = useState('1')
  const [raceStartAt, setRaceStartAt] = useState(toLocalInputValue(defaultStart))
  const [lockAt, setLockAt] = useState(toLocalInputValue(defaultStart))
  const [activateSeason, setActivateSeason] = useState(true)
  const [seedDefaultRoster, setSeedDefaultRoster] = useState(true)
  const [scoringRulesForm, setScoringRulesForm] = useState<ScoringRulesForm>(DEFAULT_SCORING_RULES)
  const [scoringNotice, setScoringNotice] = useState<string | null>(null)
  const [simulationResult, setSimulationResult] = useState<SimulateSeasonScoringResponse | null>(null)

  const groupQuery = useQuery({
    queryKey: ['group-admin', activeGroupId],
    queryFn: () => fetchGroupAdminData(activeGroupId!),
    enabled: Boolean(activeGroupId),
  })

  const preseasonQuery = useQuery({
    queryKey: ['preseason-status'],
    queryFn: fetchPreseasonStatus,
  })

  const scoringQuery = useQuery({
    queryKey: ['season-scoring', preseasonQuery.data?.selectedSeasonId],
    queryFn: () => fetchScoringConfig(preseasonQuery.data!.selectedSeasonId!),
    enabled: Boolean(preseasonQuery.data?.selectedSeasonId),
  })

  useEffect(() => {
    if (!scoringQuery.data) return
    setScoringRulesForm(scoringQuery.data.scoringRules)
  }, [scoringQuery.data])

  const approveMutation = useMutation({
    mutationFn: async (uid: string) => {
      if (!activeGroupId) throw new Error('No active group selected.')
      await approveMember(activeGroupId, uid)
    },
    onSuccess: async () => {
      setActionError(null)
      await queryClient.invalidateQueries({ queryKey: ['group-admin', activeGroupId] })
      await refreshGroups()
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Failed to approve member')
    },
  })

  const roleMutation = useMutation({
    mutationFn: async ({ uid, role }: { uid: string; role: 'admin' | 'member' }) => {
      if (!activeGroupId) throw new Error('No active group selected.')
      await setMemberRole(activeGroupId, uid, role)
    },
    onSuccess: async () => {
      setActionError(null)
      await queryClient.invalidateQueries({ queryKey: ['group-admin', activeGroupId] })
      await refreshGroups()
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Failed to update member role')
    },
  })

  const preseasonMutation = useMutation({
    mutationFn: async () => {
      const callable = httpsCallable<InitializeSeasonRequest, InitializeSeasonResponse>(functions, 'initializeSeasonBootstrap')
      const seasonYearValue = Number(seasonYear)
      const firstRaceRoundValue = Number(firstRaceRound)
      const raceStartDate = new Date(raceStartAt)
      const lockDate = new Date(lockAt)

      if (Number.isNaN(raceStartDate.getTime())) {
        throw new Error('Race start date is invalid.')
      }
      if (Number.isNaN(lockDate.getTime())) {
        throw new Error('Lock date is invalid.')
      }

      const raceStartIso = raceStartDate.toISOString()
      const lockIso = lockDate.toISOString()

      const response = await callable({
        seasonId,
        seasonName,
        seasonYear: seasonYearValue,
        activateSeason,
        firstRaceName,
        firstRaceRound: firstRaceRoundValue,
        raceStartAt: raceStartIso,
        lockAt: lockIso,
        seedDefaultRoster,
      })

      return response.data
    },
    onSuccess: async (result) => {
      setActionError(null)
      setSetupNotice(
        `Season ${result.seasonId} initialized. First race: ${result.raceId}. ` +
          `Seeded constructors: ${result.rosterSeeded.constructorsSeeded}, drivers: ${result.rosterSeeded.driversSeeded}.`,
      )

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['preseason-status'] }),
        queryClient.invalidateQueries({ queryKey: ['picks-bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-current-pick'] }),
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] }),
      ])
    },
    onError: (error) => {
      setSetupNotice(null)
      setActionError(error instanceof Error ? error.message : 'Failed to initialize season')
    },
  })

  const scoringMutation = useMutation({
    mutationFn: async () => {
      if (!scoringQuery.data?.seasonId) {
        throw new Error('No season selected to update scoring rules.')
      }

      const callable = httpsCallable<
        UpdateSeasonScoringRulesRequest,
        UpdateSeasonScoringRulesResponse
      >(functions, 'updateSeasonScoringRules')

      const response = await callable({
        seasonId: scoringQuery.data.seasonId,
        scoringRules: scoringRulesForm,
      })

      return response.data
    },
    onSuccess: async (result) => {
      setActionError(null)
      setScoringNotice(`Scoring rules updated for season ${result.seasonId}.`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['season-scoring', result.seasonId] }),
        queryClient.invalidateQueries({ queryKey: ['preseason-status'] }),
        queryClient.invalidateQueries({ queryKey: ['picks-bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-current-pick'] }),
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] }),
      ])
    },
    onError: (error) => {
      setScoringNotice(null)
      setActionError(error instanceof Error ? error.message : 'Failed to update scoring rules.')
    },
  })

  const simulateMutation = useMutation({
    mutationFn: async () => {
      if (!scoringQuery.data?.seasonId) {
        throw new Error('No season selected to simulate scoring rules.')
      }

      const callable = httpsCallable<{ seasonId: string; scoringRules: ScoringRulesForm }, SimulateSeasonScoringResponse>(
        functions,
        'simulateSeasonScoring',
      )

      const response = await callable({
        seasonId: scoringQuery.data.seasonId,
        scoringRules: scoringRulesForm,
      })

      return response.data
    },
    onSuccess: (result) => {
      setActionError(null)
      setSimulationResult(result)
    },
    onError: (error) => {
      setSimulationResult(null)
      setActionError(error instanceof Error ? error.message : 'Failed to simulate scoring rules.')
    },
  })

  const inviteLink = useMemo(() => {
    if (!groupQuery.data?.joinCode || !activeGroupId) return ''
    if (typeof window === 'undefined') return ''
    const encoded = encodeURIComponent(groupQuery.data.joinCode)
    const encodedGroupId = encodeURIComponent(activeGroupId)
    return `${window.location.origin}/groups?group=${encodedGroupId}&invite=${encoded}`
  }, [activeGroupId, groupQuery.data?.joinCode])

  if (!activeGroupId) {
    return (
      <section>
        <h2>Admin</h2>
        <p>No active group selected.</p>
      </section>
    )
  }

  if (groupQuery.isLoading) {
    return (
      <section>
        <h2>Admin</h2>
        <p>Loading group admin data...</p>
      </section>
    )
  }

  if (groupQuery.isError || !groupQuery.data) {
    return (
      <section>
        <h2>Admin</h2>
        <p className="validation-error">{(groupQuery.error as Error)?.message ?? 'Failed to load group data.'}</p>
      </section>
    )
  }

  const pendingMembers = groupQuery.data.members.filter((member) => member.status === 'pending')
  const activeMembers = groupQuery.data.members.filter((member) => member.status === 'active')
  const resolveMemberLabel = (member: MemberRow) => {
    if (member.displayName?.trim()) return member.displayName.trim()
    if (member.email?.trim()) return member.email.trim()
    if (member.uid === profile?.uid) {
      return profile.displayName || profile.email || member.uid
    }
    return member.uid
  }

  return (
    <section>
      <h2>Admin</h2>
      <p>
        Group: <strong>{groupQuery.data.groupName}</strong>
      </p>
      <p>
        Your role: <strong>{currentGroupRole}</strong>
      </p>

      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'invite'}
          className={activeTab === 'invite' ? 'admin-tab-btn active' : 'admin-tab-btn'}
          onClick={() => setActiveTab('invite')}
        >
          Invite
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'preseason'}
          className={activeTab === 'preseason' ? 'admin-tab-btn active' : 'admin-tab-btn'}
          onClick={() => setActiveTab('preseason')}
        >
          Preseason
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'scoring'}
          className={activeTab === 'scoring' ? 'admin-tab-btn active' : 'admin-tab-btn'}
          onClick={() => setActiveTab('scoring')}
        >
          Scoring
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'simulation'}
          className={activeTab === 'simulation' ? 'admin-tab-btn active' : 'admin-tab-btn'}
          onClick={() => setActiveTab('simulation')}
        >
          Simulation
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'members'}
          className={activeTab === 'members' ? 'admin-tab-btn active' : 'admin-tab-btn'}
          onClick={() => setActiveTab('members')}
        >
          Members
        </button>
      </div>

      {actionError ? <p className="validation-error">{actionError}</p> : null}

      <div className="admin-tab-panel">
        {activeTab === 'invite' ? (
          <div className="admin-card">
            <h3>Invite Link</h3>
            <p>Share this link to invite people. They will request to join and need admin approval.</p>
            <input type="text" readOnly value={inviteLink} />
            <p>
              Join code: <strong>{groupQuery.data.joinCode || 'Unavailable'}</strong>
            </p>
          </div>
        ) : null}

        {activeTab === 'preseason' ? (
          <div className="admin-card">
            <h3>Preseason Setup</h3>
            <p>Initialize season, race, and optional default roster data without opening Firestore manually.</p>
            {preseasonQuery.isLoading ? <p>Checking preseason status...</p> : null}
            {preseasonQuery.isError ? (
              <p className="validation-error">{(preseasonQuery.error as Error).message}</p>
            ) : null}
            {preseasonQuery.data ? (
              <div className="preseason-status-grid">
                <span>Seasons: {preseasonQuery.data.seasonCount}</span>
                <span>Active seasons: {preseasonQuery.data.activeSeasonCount}</span>
                <span>
                  Selected season:{' '}
                  {preseasonQuery.data.selectedSeasonId
                    ? `${preseasonQuery.data.selectedSeasonName} (${preseasonQuery.data.selectedSeasonId})`
                    : 'None'}
                </span>
                <span>Races in selected season: {preseasonQuery.data.raceCount}</span>
                <span>Drivers: {preseasonQuery.data.driversCount}</span>
                <span>Constructors: {preseasonQuery.data.constructorsCount}</span>
              </div>
            ) : null}

            <form
              className="auth-form preseason-form"
              onSubmit={(event) => {
                event.preventDefault()
                setActionError(null)
                setSetupNotice(null)
                preseasonMutation.mutate()
              }}
            >
              <label>
                Season year
                <input
                  type="number"
                  min={1950}
                  max={2100}
                  value={seasonYear}
                  onChange={(event) => {
                    const value = event.target.value
                    setSeasonYear(value)
                    if (!seasonId.trim() || seasonId === String(currentYear)) {
                      setSeasonId(value)
                    }
                    if (!seasonName.trim() || seasonName === `${currentYear} Season`) {
                      setSeasonName(`${value} Season`)
                    }
                  }}
                  required
                />
              </label>

              <label>
                Season id
                <input type="text" value={seasonId} onChange={(event) => setSeasonId(event.target.value)} required />
              </label>

              <label>
                Season name
                <input type="text" value={seasonName} onChange={(event) => setSeasonName(event.target.value)} required />
              </label>

              <label>
                First race name
                <input
                  type="text"
                  value={firstRaceName}
                  onChange={(event) => setFirstRaceName(event.target.value)}
                  required
                />
              </label>

              <label>
                First race round
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={firstRaceRound}
                  onChange={(event) => setFirstRaceRound(event.target.value)}
                  required
                />
              </label>

              <label>
                Race start
                <input
                  type="datetime-local"
                  value={raceStartAt}
                  onChange={(event) => setRaceStartAt(event.target.value)}
                  required
                />
              </label>

              <label>
                Lock date
                <input type="datetime-local" value={lockAt} onChange={(event) => setLockAt(event.target.value)} required />
              </label>

              <label>
                Activate this season
                <select
                  value={activateSeason ? 'yes' : 'no'}
                  onChange={(event) => setActivateSeason(event.target.value === 'yes')}
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>

              <label>
                Seed default drivers and constructors if empty
                <select
                  value={seedDefaultRoster ? 'yes' : 'no'}
                  onChange={(event) => setSeedDefaultRoster(event.target.value === 'yes')}
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>

              <button type="submit" disabled={preseasonMutation.isPending}>
                {preseasonMutation.isPending ? 'Initializing...' : 'Initialize Season'}
              </button>
            </form>
            {setupNotice ? <p className="notice-text">{setupNotice}</p> : null}
          </div>
        ) : null}

        {activeTab === 'scoring' ? (
          <div className="admin-card">
            <h3>Scoring Rules</h3>
            <p>Tweak how fantasy points are calculated for the selected season.</p>
            {scoringQuery.isLoading ? <p>Loading scoring rules...</p> : null}
            {scoringQuery.isError ? (
              <p className="validation-error">{(scoringQuery.error as Error).message}</p>
            ) : null}
            {scoringQuery.data ? (
              <form
                className="auth-form preseason-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  setActionError(null)
                  setScoringNotice(null)
                  scoringMutation.mutate()
                }}
              >
                <p>
                  Season: <strong>{scoringQuery.data.seasonName}</strong> ({scoringQuery.data.seasonId})
                </p>

                <label>
                  P1 points
                  <input
                    type="number"
                    min={0}
                    value={String(scoringRulesForm.podiumPoints.p1)}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        podiumPoints: {
                          ...current.podiumPoints,
                          p1: safeNumber(event.target.value, current.podiumPoints.p1),
                        },
                      }))
                    }
                  />
                </label>

                <label>
                  P2 points
                  <input
                    type="number"
                    min={0}
                    value={String(scoringRulesForm.podiumPoints.p2)}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        podiumPoints: {
                          ...current.podiumPoints,
                          p2: safeNumber(event.target.value, current.podiumPoints.p2),
                        },
                      }))
                    }
                  />
                </label>

                <label>
                  P3 points
                  <input
                    type="number"
                    min={0}
                    value={String(scoringRulesForm.podiumPoints.p3)}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        podiumPoints: {
                          ...current.podiumPoints,
                          p3: safeNumber(event.target.value, current.podiumPoints.p3),
                        },
                      }))
                    }
                  />
                </label>

                <label>
                  Constructor points mode
                  <select
                    value={scoringRulesForm.constructorPointsMode}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        constructorPointsMode: event.target.value === 'custom' ? 'custom' : 'official',
                      }))
                    }
                  >
                    <option value="official">Official race points</option>
                    <option value="custom">Custom points per constructor</option>
                  </select>
                </label>

                <label>
                  Constructor points multiplier
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={String(scoringRulesForm.constructorPointsMultiplier)}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        constructorPointsMultiplier: safeNumber(
                          event.target.value,
                          current.constructorPointsMultiplier,
                        ),
                      }))
                    }
                  />
                </label>

                <label>
                  Constructor standings gain (per place)
                  <input
                    type="number"
                    min={0}
                    value={String(scoringRulesForm.standingsMovement.constructorGain)}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        standingsMovement: {
                          ...current.standingsMovement,
                          constructorGain: safeNumber(
                            event.target.value,
                            current.standingsMovement.constructorGain,
                          ),
                        },
                      }))
                    }
                  />
                </label>

                <label>
                  Driver standings gain (per place)
                  <input
                    type="number"
                    min={0}
                    value={String(scoringRulesForm.standingsMovement.driverGain)}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        standingsMovement: {
                          ...current.standingsMovement,
                          driverGain: safeNumber(event.target.value, current.standingsMovement.driverGain),
                        },
                      }))
                    }
                  />
                </label>

                <label>
                  DNF penalty enabled
                  <select
                    value={scoringRulesForm.dnfPenalty.enabled ? 'yes' : 'no'}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        dnfPenalty: {
                          ...current.dnfPenalty,
                          enabled: event.target.value === 'yes',
                        },
                      }))
                    }
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>

                <label>
                  DNF penalty value
                  <input
                    type="number"
                    min={0}
                    value={String(scoringRulesForm.dnfPenalty.value)}
                    disabled={!scoringRulesForm.dnfPenalty.enabled}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        dnfPenalty: {
                          ...current.dnfPenalty,
                          value: safeNumber(event.target.value, current.dnfPenalty.value),
                        },
                      }))
                    }
                  />
                </label>

                <label>
                  Captain multiplier
                  <input
                    type="number"
                    min={1}
                    step="0.1"
                    value={String(scoringRulesForm.captainMultiplier)}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        captainMultiplier: safeNumber(event.target.value, current.captainMultiplier),
                      }))
                    }
                  />
                </label>

                <label>
                  Wildcard multiplier
                  <input
                    type="number"
                    min={1}
                    step="0.1"
                    value={String(scoringRulesForm.wildcardMultiplier)}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        wildcardMultiplier: safeNumber(event.target.value, current.wildcardMultiplier),
                      }))
                    }
                  />
                </label>

                <label>
                  Budget mode enabled
                  <select
                    value={scoringRulesForm.budgetMode.enabled ? 'yes' : 'no'}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        budgetMode: {
                          ...current.budgetMode,
                          enabled: event.target.value === 'yes',
                        },
                      }))
                    }
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>

                <label>
                  Budget cap
                  <input
                    type="number"
                    min={0}
                    value={String(scoringRulesForm.budgetMode.cap)}
                    disabled={!scoringRulesForm.budgetMode.enabled}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        budgetMode: {
                          ...current.budgetMode,
                          cap: safeNumber(event.target.value, current.budgetMode.cap),
                        },
                      }))
                    }
                  />
                </label>

                <label>
                  Require single constructor in budget mode
                  <select
                    value={scoringRulesForm.budgetMode.requireSingleConstructor ? 'yes' : 'no'}
                    disabled={!scoringRulesForm.budgetMode.enabled}
                    onChange={(event) =>
                      setScoringRulesForm((current) => ({
                        ...current,
                        budgetMode: {
                          ...current.budgetMode,
                          requireSingleConstructor: event.target.value === 'yes',
                        },
                      }))
                    }
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                {scoringRulesForm.constructorPointsMode === 'custom' ? (
                  <>
                    <h4>Custom Constructor Points</h4>
                    <div className="preseason-status-grid">
                      {scoringQuery.data.constructors.map((constructor) => (
                        <label key={constructor.id}>
                          {constructor.name}
                          <input
                            type="number"
                            min={0}
                            value={String(scoringRulesForm.constructorPointsCustom[constructor.id] ?? 0)}
                            onChange={(event) =>
                              setScoringRulesForm((current) => ({
                                ...current,
                                constructorPointsCustom: {
                                  ...current.constructorPointsCustom,
                                  [constructor.id]: safeNumber(
                                    event.target.value,
                                    current.constructorPointsCustom[constructor.id] ?? 0,
                                  ),
                                },
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </>
                ) : null}

                <button type="submit" disabled={scoringMutation.isPending}>
                  {scoringMutation.isPending ? 'Saving...' : 'Save Scoring Rules'}
                </button>
              </form>
            ) : null}
            {scoringNotice ? <p className="notice-text">{scoringNotice}</p> : null}
          </div>
        ) : null}

        {activeTab === 'members' ? (
          <>
            <div className="admin-card">
              <h3>Pending Requests</h3>
              {pendingMembers.length === 0 ? (
                <p>No pending requests.</p>
              ) : (
                <ul className="admin-list">
                  {pendingMembers.map((member) => (
                    <li key={member.uid}>
                      <span>{resolveMemberLabel(member)}</span>
                      <button
                        type="button"
                        onClick={() => approveMutation.mutate(member.uid)}
                        disabled={approveMutation.isPending}
                      >
                        Approve
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="admin-card">
              <h3>Active Members</h3>
              <ul className="admin-list">
                {activeMembers.map((member) => {
                  const isOwner = member.role === 'owner'
                  const canPromote = currentGroupRole === 'owner' && !isOwner
                  const roleLabel = member.uid === groupQuery.data.ownerUid ? 'owner' : member.role

                  return (
                    <li key={member.uid}>
                      <span>
                        {resolveMemberLabel(member)} ({roleLabel})
                      </span>
                      {canPromote ? (
                        <button
                          type="button"
                          onClick={() =>
                            roleMutation.mutate({
                              uid: member.uid,
                              role: member.role === 'admin' ? 'member' : 'admin',
                            })
                          }
                          disabled={roleMutation.isPending}
                        >
                          {member.role === 'admin' ? 'Make Member' : 'Make Admin'}
                        </button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        ) : null}

        {activeTab === 'simulation' ? (
          <div className="admin-card">
            <h3>Admin Simulation Tool</h3>
            <p>Test these scoring rules against past races before applying them.</p>
            <button type="button" onClick={() => simulateMutation.mutate()} disabled={simulateMutation.isPending}>
              {simulateMutation.isPending ? 'Simulating...' : 'Run Simulation'}
            </button>

            {simulationResult ? (
              <>
                <p>
                  Simulated entries: <strong>{simulationResult.sampleSize}</strong>
                </p>
                <h4>Top Gainers</h4>
                <ul className="admin-list">
                  {simulationResult.topGainers.slice(0, 10).map((row) => (
                    <li key={`gain-${row.groupId}-${row.uid}`}>
                      <span>
                        {row.uid} ({row.groupId})
                      </span>
                      <strong>+{row.delta}</strong>
                    </li>
                  ))}
                </ul>
                <h4>Top Losers</h4>
                <ul className="admin-list">
                  {simulationResult.topLosers.slice(0, 10).map((row) => (
                    <li key={`loss-${row.groupId}-${row.uid}`}>
                      <span>
                        {row.uid} ({row.groupId})
                      </span>
                      <strong>{row.delta}</strong>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>No simulation result yet.</p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}

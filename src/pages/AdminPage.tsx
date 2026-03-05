import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useMemo, useState } from 'react'
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

  const groupQuery = useQuery({
    queryKey: ['group-admin', activeGroupId],
    queryFn: () => fetchGroupAdminData(activeGroupId!),
    enabled: Boolean(activeGroupId),
  })

  const preseasonQuery = useQuery({
    queryKey: ['preseason-status'],
    queryFn: fetchPreseasonStatus,
  })

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

      <div className="admin-card">
        <h3>Invite Link</h3>
        <p>Share this link to invite people. They will request to join and need admin approval.</p>
        <input type="text" readOnly value={inviteLink} />
        <p>
          Join code: <strong>{groupQuery.data.joinCode || 'Unavailable'}</strong>
        </p>
      </div>

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
            <input type="text" value={firstRaceName} onChange={(event) => setFirstRaceName(event.target.value)} required />
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
            <input type="datetime-local" value={raceStartAt} onChange={(event) => setRaceStartAt(event.target.value)} required />
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

      {actionError ? <p className="validation-error">{actionError}</p> : null}
    </section>
  )
}

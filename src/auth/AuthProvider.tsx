import { onAuthStateChanged, type User } from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { auth, db } from '../lib/firebase'
import { AuthContext, type GroupRole, type GroupSummary, type UserProfile } from './AuthContext'

function normalizeProfile(uid: string, data: DocumentData | undefined, fallbackUser: User): UserProfile {
  return {
    uid,
    displayName: data?.displayName ?? fallbackUser.displayName ?? 'F1 Player',
    email: data?.email ?? fallbackUser.email ?? '',
    role: data?.role === 'admin' ? 'admin' : 'user',
    activeGroupId: (data?.activeGroupId as string | undefined) ?? null,
    createdAt: data?.createdAt,
    updatedAt: data?.updatedAt,
  }
}

function generateJoinCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function normalizeGroupName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

async function ensureUserProfile(user: User): Promise<UserProfile> {
  const userRef = doc(db, 'users', user.uid)
  const snapshot = await getDoc(userRef)

  if (!snapshot.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      displayName: user.displayName ?? 'F1 Player',
      email: user.email ?? '',
      role: 'user',
      activeGroupId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })

    const created = await getDoc(userRef)
    return normalizeProfile(user.uid, created.data(), user)
  }

  const existing = snapshot.data()

  await setDoc(
    userRef,
    {
      displayName: existing.displayName ?? user.displayName ?? 'F1 Player',
      email: existing.email ?? user.email ?? '',
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )

  const refreshed = await getDoc(userRef)
  return normalizeProfile(user.uid, refreshed.data(), user)
}

async function fetchGroupsForUser(uid: string): Promise<GroupSummary[]> {
  const groupsById = new Map<string, GroupSummary>()

  const allGroupsSnapshot = await getDocs(collection(db, 'groups'))

  await Promise.all(
    allGroupsSnapshot.docs.map(async (groupDoc) => {
      const groupData = groupDoc.data()
      const groupId = groupDoc.id
      const name = (groupData.name as string | undefined) ?? groupId
      const joinCode = (groupData.joinCode as string | undefined) ?? ''
      const ownerUid = (groupData.ownerUid as string | undefined) ?? ''

      if (ownerUid === uid) {
        groupsById.set(groupId, {
          id: groupId,
          name,
          joinCode,
          role: 'owner',
          status: 'active',
        })
        return
      }

      const membershipRef = doc(db, 'groups', groupId, 'members', uid)
      const membershipSnap = await getDoc(membershipRef)
      if (!membershipSnap.exists()) return

      const membershipData = membershipSnap.data()
      const rawRole = membershipData.role as string | undefined
      const rawStatus = membershipData.status as string | undefined
      const role: GroupRole = rawRole === 'owner' || rawRole === 'admin' ? rawRole : 'member'

      groupsById.set(groupId, {
        id: groupId,
        name,
        joinCode,
        role,
        status: rawStatus === 'pending' ? 'pending' : 'active',
      })
    }),
  )

  return Array.from(groupsById.values()).sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchGroupSummaryForUser(uid: string, groupId: string): Promise<GroupSummary | null> {
  const trimmedGroupId = groupId.trim()
  if (!trimmedGroupId) return null

  const groupRef = doc(db, 'groups', trimmedGroupId)
  const groupSnap = await getDoc(groupRef)
  if (!groupSnap.exists()) return null

  const groupData = groupSnap.data()
  const name = (groupData.name as string | undefined) ?? trimmedGroupId
  const joinCode = (groupData.joinCode as string | undefined) ?? ''
  const ownerUid = (groupData.ownerUid as string | undefined) ?? ''

  if (ownerUid === uid) {
    return {
      id: trimmedGroupId,
      name,
      joinCode,
      role: 'owner',
      status: 'active',
    }
  }

  const membershipRef = doc(db, 'groups', trimmedGroupId, 'members', uid)
  const membershipSnap = await getDoc(membershipRef)
  if (!membershipSnap.exists()) return null

  const membershipData = membershipSnap.data()
  const rawRole = membershipData.role as string | undefined
  const rawStatus = membershipData.status as string | undefined
  const role: GroupRole = rawRole === 'owner' || rawRole === 'admin' ? rawRole : 'member'

  return {
    id: trimmedGroupId,
    name,
    joinCode,
    role,
    status: rawStatus === 'pending' ? 'pending' : 'active',
  }
}

async function backfillOwnerMemberships(uid: string, profileData: UserProfile | null): Promise<boolean> {
  const ownerGroupsQuery = query(collection(db, 'groups'), where('ownerUid', '==', uid))
  const ownerGroupsSnapshot = await getDocs(ownerGroupsQuery)

  let changed = false
  const displayName = profileData?.displayName ?? 'F1 Player'
  const email = profileData?.email ?? ''

  for (const ownerGroupDoc of ownerGroupsSnapshot.docs) {
    const memberRef = doc(db, 'groups', ownerGroupDoc.id, 'members', uid)
    const memberSnapshot = await getDoc(memberRef)

    if (!memberSnapshot.exists()) {
      await setDoc(memberRef, {
        uid,
        displayName,
        email,
        role: 'owner',
        status: 'active',
        joinedAt: serverTimestamp(),
        approvedAt: serverTimestamp(),
      })
      changed = true
      continue
    }

    const memberData = memberSnapshot.data()
    const role = (memberData.role as string | undefined) ?? 'member'
    const status = (memberData.status as string | undefined) ?? 'pending'
    const hasDisplayName = typeof memberData.displayName === 'string' && memberData.displayName.trim().length > 0
    const hasEmail = typeof memberData.email === 'string' && memberData.email.trim().length > 0

    if (role !== 'owner' || status !== 'active' || !hasDisplayName || !hasEmail) {
      await setDoc(
        memberRef,
        {
          uid,
          displayName,
          email,
          role: 'owner',
          status: 'active',
          approvedAt: serverTimestamp(),
        },
        { merge: true },
      )
      changed = true
    }
  }

  return changed
}

type AuthProviderProps = {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadGroupsAndSelection = useCallback(async (uid: string, profileData: UserProfile | null) => {
    let memberships = await fetchGroupsForUser(uid)
    const preferredGroupId = profileData?.activeGroupId ?? null

    // Self-heal legacy/incomplete group ownership links so owners are not stranded on /groups.
    const didRepair = await backfillOwnerMemberships(uid, profileData)
    if (didRepair) {
      memberships = await fetchGroupsForUser(uid)
    }

    if (preferredGroupId && !memberships.some((group) => group.id === preferredGroupId)) {
      try {
        const preferredSummary = await fetchGroupSummaryForUser(uid, preferredGroupId)
        if (preferredSummary) {
          memberships = [...memberships, preferredSummary]
        }
      } catch (error) {
        console.warn('Failed to hydrate preferred group from activeGroupId', error)
      }
    }

    memberships = memberships
      .filter((group, index, list) => list.findIndex((item) => item.id === group.id) === index)
      .sort((a, b) => a.name.localeCompare(b.name))

    setGroups(memberships)

    const activeMemberships = memberships.filter((group) => group.status === 'active')

    const hasPreferredGroup = preferredGroupId
      ? activeMemberships.some((group) => group.id === preferredGroupId)
      : false

    const nextActiveGroupId = hasPreferredGroup
      ? preferredGroupId
      : activeMemberships.length > 0
        ? activeMemberships[0].id
        : null

    setActiveGroupId(nextActiveGroupId)

    if (nextActiveGroupId !== preferredGroupId) {
      await setDoc(
        doc(db, 'users', uid),
        {
          activeGroupId: nextActiveGroupId,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )

      setProfile((current) =>
        current
          ? {
              ...current,
              activeGroupId: nextActiveGroupId,
            }
          : current,
      )
    }
  }, [])

  const refreshGroups = useCallback(async () => {
    if (!user) return
    await loadGroupsAndSelection(user.uid, profile)
  }, [loadGroupsAndSelection, profile, user])

  const createGroup = useCallback(
    async (name: string) => {
      if (!user) throw new Error('You must be signed in to create a group.')

      const trimmedName = name.trim()
      if (!trimmedName) throw new Error('Group name is required.')
      const normalizedName = normalizeGroupName(trimmedName)
      if (normalizedName.length < 3) throw new Error('Group name must be at least 3 characters.')

      const groupRef = doc(collection(db, 'groups'))
      const groupNameRef = doc(db, 'groupNames', normalizedName)
      const joinCode = generateJoinCode()

      await runTransaction(db, async (transaction) => {
        const nameSnapshot = await transaction.get(groupNameRef)
        if (nameSnapshot.exists()) {
          throw new Error('Group name already exists. Choose another name.')
        }

        transaction.set(groupNameRef, {
          groupId: groupRef.id,
          ownerUid: user.uid,
          createdAt: serverTimestamp(),
        })

        transaction.set(groupRef, {
          name: trimmedName,
          normalizedName,
          ownerUid: user.uid,
          joinCode,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      })

      await setDoc(doc(db, 'groups', groupRef.id, 'members', user.uid), {
        uid: user.uid,
        displayName: user.displayName ?? profile?.displayName ?? 'F1 Player',
        email: user.email ?? profile?.email ?? '',
        role: 'owner',
        status: 'active',
        joinedAt: serverTimestamp(),
        approvedAt: serverTimestamp(),
      })

      await setDoc(
        doc(db, 'users', user.uid),
        {
          activeGroupId: groupRef.id,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )

      // Immediately reflect the newly created owner group in local state.
      setActiveGroupId(groupRef.id)
      setProfile((current) => ({
        uid: current?.uid ?? user.uid,
        displayName: current?.displayName ?? user.displayName ?? 'F1 Player',
        email: current?.email ?? user.email ?? '',
        role: current?.role ?? 'user',
        activeGroupId: groupRef.id,
        createdAt: current?.createdAt,
        updatedAt: current?.updatedAt,
      }))
      setGroups((current) => {
        const existing = current.find((group) => group.id === groupRef.id)
        if (existing) return current

        return [
          ...current,
          {
            id: groupRef.id,
            name: trimmedName,
            joinCode,
            role: 'owner' as const,
            status: 'active' as const,
          },
        ].sort((a, b) => a.name.localeCompare(b.name))
      })

      try {
        await loadGroupsAndSelection(user.uid, {
          ...(profile ?? {
            uid: user.uid,
            displayName: user.displayName ?? 'F1 Player',
            email: user.email ?? '',
            role: 'user',
          }),
          activeGroupId: groupRef.id,
        })
      } catch (refreshError) {
        // Group creation already succeeded and local state is already populated.
        console.warn('Group created but membership refresh failed', refreshError)
      }
    },
    [loadGroupsAndSelection, profile, user],
  )

  const joinGroupByCode = useCallback(
    async (groupId: string, joinCodeInput: string) => {
      if (!user) throw new Error('You must be signed in to join a group.')

      const trimmedGroupId = groupId.trim()
      if (!trimmedGroupId) throw new Error('Select a group first.')

      const joinCode = joinCodeInput.trim().toUpperCase()
      if (!joinCode) throw new Error('Join code is required.')

      const groupRef = doc(db, 'groups', trimmedGroupId)
      const groupSnapshot = await getDoc(groupRef)
      if (!groupSnapshot.exists()) {
        throw new Error('Selected group was not found.')
      }

      const storedJoinCode = ((groupSnapshot.data().joinCode as string | undefined) ?? '').toUpperCase()
      if (storedJoinCode !== joinCode) {
        throw new Error('Invite code does not match the selected group.')
      }

      const memberRef = doc(db, 'groups', trimmedGroupId, 'members', user.uid)
      const memberSnapshot = await getDoc(memberRef)

      if (memberSnapshot.exists()) {
        const status = memberSnapshot.data().status as string | undefined

        if (status === 'active') {
          await setDoc(
            doc(db, 'users', user.uid),
            {
              activeGroupId: trimmedGroupId,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          )

          await loadGroupsAndSelection(user.uid, {
            ...(profile ?? {
              uid: user.uid,
              displayName: user.displayName ?? 'F1 Player',
              email: user.email ?? '',
              role: 'user',
            }),
            activeGroupId: trimmedGroupId,
          })

          return
        }

        throw new Error('Your join request is pending approval.')
      }

      await setDoc(
        memberRef,
        {
          uid: user.uid,
          displayName: user.displayName ?? profile?.displayName ?? 'F1 Player',
          email: user.email ?? profile?.email ?? '',
          role: 'member',
          status: 'pending',
          requestedAt: serverTimestamp(),
        },
        { merge: true },
      )

      await loadGroupsAndSelection(user.uid, profile)
      throw new Error('Join request sent. A group admin must approve you.')
    },
    [loadGroupsAndSelection, profile, user],
  )

  const switchGroup = useCallback(
    async (groupId: string) => {
      if (!user) throw new Error('You must be signed in to switch groups.')

      const group = groups.find((item) => item.id === groupId)
      if (!group || group.status !== 'active') {
        throw new Error('You are not an approved member of that group.')
      }

      await setDoc(
        doc(db, 'users', user.uid),
        {
          activeGroupId: groupId,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )

      setActiveGroupId(groupId)
      setProfile((current) => (current ? { ...current, activeGroupId: groupId } : current))
    },
    [groups, user],
  )

  const approveMember = useCallback(
    async (groupId: string, uid: string) => {
      if (!user) throw new Error('You must be signed in.')

      const actorGroup = groups.find((item) => item.id === groupId)
      if (!actorGroup || actorGroup.status !== 'active' || (actorGroup.role !== 'owner' && actorGroup.role !== 'admin')) {
        throw new Error('Only group admins can approve members.')
      }

      await setDoc(
        doc(db, 'groups', groupId, 'members', uid),
        {
          status: 'active',
          role: 'member',
          approvedAt: serverTimestamp(),
          approvedBy: user.uid,
          joinedAt: serverTimestamp(),
        },
        { merge: true },
      )
    },
    [groups, user],
  )

  const setMemberRole = useCallback(
    async (groupId: string, uid: string, role: GroupRole) => {
      if (!user) throw new Error('You must be signed in.')
      if (role !== 'admin' && role !== 'member') throw new Error('Invalid role update.')

      const actorGroup = groups.find((item) => item.id === groupId)
      if (!actorGroup || actorGroup.status !== 'active' || actorGroup.role !== 'owner') {
        throw new Error('Only group owners can change member roles.')
      }

      await setDoc(
        doc(db, 'groups', groupId, 'members', uid),
        {
          role,
          status: 'active',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
    },
    [groups, user],
  )

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)

      if (!nextUser) {
        setProfile(null)
        setGroups([])
        setActiveGroupId(null)
        setLoading(false)
        return
      }

      try {
        const nextProfile = await ensureUserProfile(nextUser)
        setProfile(nextProfile)
        await loadGroupsAndSelection(nextUser.uid, nextProfile)
      } catch (error) {
        console.error('Failed to initialize auth context', error)
        setProfile(null)
        setGroups([])
        setActiveGroupId(null)
      } finally {
        setLoading(false)
      }
    })

    return unsubscribe
  }, [loadGroupsAndSelection])

  const currentGroupRole = useMemo(() => {
    if (!activeGroupId) return null
    return groups.find((group) => group.id === activeGroupId && group.status === 'active')?.role ?? null
  }, [activeGroupId, groups])

  const value = useMemo(
    () => ({
      user,
      profile,
      groups,
      activeGroupId,
      currentGroupRole,
      loading,
      createGroup,
      joinGroupByCode,
      switchGroup,
      approveMember,
      setMemberRole,
      refreshGroups,
    }),
    [
      activeGroupId,
      approveMember,
      createGroup,
      currentGroupRole,
      groups,
      joinGroupByCode,
      loading,
      profile,
      refreshGroups,
      setMemberRole,
      switchGroup,
      user,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

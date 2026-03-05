import { createContext } from 'react'
import type { User } from 'firebase/auth'
import type { Timestamp } from 'firebase/firestore'

type UserRole = 'user' | 'admin'
export type GroupRole = 'owner' | 'admin' | 'member'
export type MembershipStatus = 'active' | 'pending'

export type UserProfile = {
  uid: string
  displayName: string
  email: string
  role: UserRole
  activeGroupId?: string | null
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export type GroupSummary = {
  id: string
  name: string
  joinCode: string
  role: GroupRole
  status: MembershipStatus
}

export type AuthContextValue = {
  user: User | null
  profile: UserProfile | null
  groups: GroupSummary[]
  activeGroupId: string | null
  currentGroupRole: GroupRole | null
  loading: boolean
  createGroup: (name: string) => Promise<void>
  joinGroupByCode: (groupId: string, joinCode: string) => Promise<void>
  switchGroup: (groupId: string) => Promise<void>
  approveMember: (groupId: string, uid: string) => Promise<void>
  setMemberRole: (groupId: string, uid: string, role: GroupRole) => Promise<void>
  refreshGroups: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

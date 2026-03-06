import { type FormEvent, useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { ThemeToggle } from '../components/ThemeToggle'
import { db } from '../lib/firebase'
import { signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'

function normalizeGroupName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function GroupsPage() {
  const { activeGroupId, groups, createGroup, joinGroupByCode, switchGroup } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [groupName, setGroupName] = useState('')
  const [targetGroupId, setTargetGroupId] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const inviteCode = searchParams.get('invite')
    const inviteGroupId = searchParams.get('group')

    if (inviteGroupId) {
      setTargetGroupId(inviteGroupId)
    }

    if (inviteCode) {
      setJoinCode(inviteCode.toUpperCase())
      setNotice('Invite code detected. Submit to request group access.')
    }
  }, [searchParams])

  const activeMemberships = groups.filter((group) => group.status === 'active')
  const pendingMemberships = groups.filter((group) => group.status === 'pending')

  useEffect(() => {
    if (activeMemberships.length === 0) return

    const hasSelectedActiveGroup = activeGroupId
      ? activeMemberships.some((group) => group.id === activeGroupId)
      : false

    if (hasSelectedActiveGroup) {
      navigate('/app', { replace: true })
      return
    }

    const fallbackGroupId = activeMemberships[0].id
    void (async () => {
      try {
        await switchGroup(fallbackGroupId)
      } catch (error) {
        console.warn('Auto-select active group failed', error)
      } finally {
        navigate('/app', { replace: true })
      }
    })()
  }, [activeGroupId, activeMemberships, navigate, switchGroup])

  const handleCreateGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const normalizedName = normalizeGroupName(groupName)
      if (normalizedName.length < 3) {
        throw new Error('Group name must be at least 3 characters.')
      }

      const existingName = await getDoc(doc(db, 'groupNames', normalizedName))
      if (existingName.exists()) {
        throw new Error('Group name already exists. Choose another name.')
      }

      await createGroup(groupName)
      setGroupName('')
      navigate('/app', { replace: true })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create group')
    } finally {
      setSaving(false)
    }
  }

  const handleJoinGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      await joinGroupByCode(targetGroupId, joinCode)
      setJoinCode('')
      setNotice('Request sent. A group admin must approve you before you can enter.')
    } catch (joinError) {
      const message = joinError instanceof Error ? joinError.message : 'Failed to join group'

      if (message.toLowerCase().includes('pending') || message.toLowerCase().includes('request sent')) {
        setNotice(message)
      } else {
        setError(message)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app-shell">
      <div className="groups-top-actions">
        <button type="button" className="signout-btn-strong" onClick={() => signOut(auth)}>
          Sign out
        </button>
        <ThemeToggle />
      </div>
      <section>
        <h2>Your Groups</h2>
        <p>First-time users must create a group or request access to an existing one.</p>

        {activeMemberships.length > 0 ? (
          <div className="groups-list">
            <h3>Approved Groups</h3>
            <ul>
              {activeMemberships.map((group) => (
                <li key={group.id}>
                  <div>
                    <strong>{group.name}</strong>
                    <p>Role: {group.role}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => switchGroup(group.id)}
                    disabled={saving || group.id === activeGroupId}
                  >
                    {group.id === activeGroupId ? 'Active' : 'Use Group'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {pendingMemberships.length > 0 ? (
          <div className="groups-list pending-groups">
            <h3>Pending Approval</h3>
            <ul>
              {pendingMemberships.map((group) => (
                <li key={group.id}>
                  <div>
                    <strong>{group.name}</strong>
                    <p>Status: pending admin approval</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="group-sections">
          <div className="admin-card">
            <h3>Create Group</h3>
            <form className="auth-form" onSubmit={handleCreateGroup}>
              <label>
                Group name
                <input
                  type="text"
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Create Group'}
              </button>
            </form>
          </div>

          <div className="admin-card">
            <h3>Request to Join</h3>
            <p>Enter the group id and invite code from your admin's invite link.</p>
            <form className="auth-form" onSubmit={handleJoinGroup}>
              <label>
                Group id
                <input
                  type="text"
                  value={targetGroupId}
                  onChange={(event) => setTargetGroupId(event.target.value)}
                  required
                />
              </label>
              <label>
                Invite code
                <input
                  type="text"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  required
                />
              </label>
              <button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Request Access'}
              </button>
            </form>
          </div>
        </div>

        {notice ? <p className="notice-text">{notice}</p> : null}
        {error ? <p className="validation-error">{error}</p> : null}
      </section>
    </div>
  )
}

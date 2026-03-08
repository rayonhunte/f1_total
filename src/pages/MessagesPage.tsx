import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { db } from '../lib/firebase'

type GroupMember = { uid: string; displayName: string }

type MessageRow = {
  id: string
  type?: 'system'
  uid?: string
  displayName?: string
  text: string
  taggedUids?: string[]
  createdAt: Date
  updatedAt?: Date
  editedAt?: Date
}

function parseTimestamp(v: unknown): Date {
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate()
  }
  if (typeof v === 'string') return new Date(v)
  return new Date(0)
}

export function MessagesPage() {
  const { profile, activeGroupId } = useAuth()
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [composerText, setComposerText] = useState('')
  const [taggedUids, setTaggedUids] = useState<string[]>([])
  const [mentionQuery, setMentionQuery] = useState('')
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionAnchor, setMentionAnchor] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeMembers = useMemo(
    () => members.filter((m) => m.uid !== profile?.uid),
    [members, profile?.uid],
  )
  const mentionCandidates = useMemo(
    () =>
      activeMembers.filter((m) =>
        (m.displayName || m.uid).toLowerCase().includes(mentionQuery.toLowerCase()),
      ),
    [activeMembers, mentionQuery],
  )

  useEffect(() => {
    if (!activeGroupId) return
    const membersRef = collection(db, 'groups', activeGroupId, 'members')
    getDocs(membersRef).then((snap) => {
      const list = snap.docs
        .filter((d) => (d.data().status as string) === 'active')
        .map((d) => ({
          uid: d.id,
          displayName: String(d.data().displayName ?? d.data().email ?? d.id),
        }))
        .sort((a, b) => (a.displayName || a.uid).localeCompare(b.displayName || b.uid))
      setMembers(list)
    })
  }, [activeGroupId])

  useEffect(() => {
    if (!activeGroupId) return
    const messagesRef = collection(db, 'groups', activeGroupId, 'messages')
    const q = query(
      messagesRef,
      orderBy('createdAt', 'desc'),
      limit(100),
    )
    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data()
        const type = data.type === 'system' ? ('system' as const) : undefined
        return {
          id: d.id,
          type,
          uid: data.uid as string | undefined,
          displayName: data.displayName as string | undefined,
          text: String(data.text ?? ''),
          taggedUids: Array.isArray(data.taggedUids) ? (data.taggedUids as string[]) : undefined,
          createdAt: parseTimestamp(data.createdAt),
          updatedAt: data.updatedAt ? parseTimestamp(data.updatedAt) : undefined,
          editedAt: data.editedAt ? parseTimestamp(data.editedAt) : undefined,
        } satisfies MessageRow
      })
      setMessages(list)
    })
    return () => unsubscribe()
  }, [activeGroupId])

  const handleComposerChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value
      const cursor = e.target.selectionStart ?? 0
      setComposerText(value)

      const beforeCursor = value.slice(0, cursor)
      const atMatch = beforeCursor.match(/@(\w*)$/)
      if (atMatch) {
        setMentionQuery(atMatch[1])
        setMentionAnchor(cursor - atMatch[0].length)
        setShowMentionDropdown(true)
      } else {
        setShowMentionDropdown(false)
      }
    },
    [],
  )

  const insertMention = useCallback(
    (member: GroupMember) => {
      if (!textareaRef.current) return
      const start = mentionAnchor
      const before = composerText.slice(0, start)
      const afterMatch = composerText.slice(start).match(/^@\w*/)
      const after = afterMatch ? composerText.slice(start + afterMatch[0].length) : composerText.slice(start)
      const insert = `@${member.displayName}`
      const next = before + insert + (after.startsWith(' ') ? '' : ' ') + after
      setComposerText(next)
      setTaggedUids((prev) => (prev.includes(member.uid) ? prev : [...prev, member.uid]))
      setShowMentionDropdown(false)
      setTimeout(() => textareaRef.current?.focus(), 0)
    },
    [composerText, mentionAnchor],
  )

  const submitMessage = useCallback(async () => {
    if (!activeGroupId || !profile?.uid || !profile?.displayName?.trim()) return
    const text = composerText.trim()
    if (!text) return
    setSubmitting(true)
    try {
      const messagesRef = collection(db, 'groups', activeGroupId, 'messages')
      const docRef = await addDoc(messagesRef, {
        uid: profile.uid,
        displayName: profile.displayName || 'F1 Player',
        text,
        taggedUids,
        createdAt: serverTimestamp(),
      })
      setComposerText('')
      setTaggedUids([])

      if (taggedUids.length > 0) {
        const notificationsRef = collection(db, 'notifications')
        const body = `${profile.displayName || 'Someone'} mentioned you in a message.`
        for (const uid of taggedUids) {
          await addDoc(notificationsRef, {
            uid,
            type: 'mention',
            title: 'Mention in group',
            body,
            data: { groupId: activeGroupId, messageId: docRef.id },
            createdAt: serverTimestamp(),
          })
        }
      }
    } finally {
      setSubmitting(false)
    }
  }, [activeGroupId, profile, composerText, taggedUids])

  const startEdit = useCallback((msg: MessageRow) => {
    if (msg.uid !== profile?.uid) return
    setEditingId(msg.id)
    setEditText(msg.text)
  }, [profile?.uid])

  const saveEdit = useCallback(async () => {
    if (!activeGroupId || !editingId) return
    const text = editText.trim()
    if (!text) return
    const ref = doc(db, 'groups', activeGroupId, 'messages', editingId)
    await updateDoc(ref, {
      text,
      updatedAt: serverTimestamp(),
      editedAt: serverTimestamp(),
    })
    setEditingId(null)
    setEditText('')
  }, [activeGroupId, editingId, editText])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditText('')
  }, [])

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!activeGroupId) return
      await deleteDoc(doc(db, 'groups', activeGroupId, 'messages', messageId))
    },
    [activeGroupId],
  )

  if (!activeGroupId) {
    return (
      <section>
        <h2>Messages</h2>
        <p>Select a group to view and send messages.</p>
        <Link to="/groups" className="secondary-btn card-link-btn">
          Go to groups
        </Link>
      </section>
    )
  }

  const reversedMessages = [...messages].reverse()

  return (
    <section>
      <h2>Group messages</h2>
      <p>Post messages and @-mention other members. Edits are timestamped.</p>

      <div className="dashboard-card" style={{ maxHeight: '60vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem' }}>
          {reversedMessages.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>No messages yet. Send one below.</p>
          ) : (
            <ul className="race-score-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {reversedMessages.map((msg) => (
                <li
                  key={msg.id}
                  style={{
                    marginBottom: '0.75rem',
                    padding: '0.5rem 0.65rem',
                    borderLeft: msg.type === 'system' ? '3px solid var(--muted)' : undefined,
                    opacity: msg.type === 'system' ? 0.95 : 1,
                  }}
                >
                  {msg.type === 'system' ? (
                    <>
                      <span style={{ fontWeight: 700, color: 'var(--muted)', fontSize: '0.85rem' }}>
                        System
                      </span>
                      <span style={{ marginLeft: '0.35rem' }}>{msg.text}</span>
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <div>
                          <strong>{msg.displayName ?? msg.uid ?? 'Unknown'}</strong>
                          {msg.editedAt && (
                            <span style={{ fontSize: '0.8rem', color: 'var(--muted)', marginLeft: '0.35rem' }}>
                              (edited at {msg.editedAt.toLocaleString()})
                            </span>
                          )}
                        </div>
                        {msg.uid === profile?.uid && editingId !== msg.id && (
                          <span style={{ display: 'flex', gap: '0.35rem' }}>
                            <button type="button" className="secondary-btn" onClick={() => startEdit(msg)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="signout-btn"
                              onClick={() => deleteMessage(msg.id)}
                            >
                              Delete
                            </button>
                          </span>
                        )}
                      </div>
                      {editingId === msg.id ? (
                        <div style={{ marginTop: '0.5rem' }}>
                          <textarea
                            aria-label="Edit message text"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={2}
                            style={{ width: '100%', marginBottom: '0.35rem' }}
                          />
                          <button type="button" onClick={saveEdit}>
                            Save
                          </button>
                          <button type="button" className="secondary-btn" onClick={cancelEdit} style={{ marginLeft: '0.35rem' }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <p style={{ margin: '0.25rem 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {msg.text}
                        </p>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <label htmlFor="messages-composer" style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
            New message (type @ to mention)
          </label>
          <textarea
            id="messages-composer"
            ref={textareaRef}
            value={composerText}
            onChange={handleComposerChange}
            onBlur={() => setTimeout(() => setShowMentionDropdown(false), 180)}
            placeholder="Type a message..."
            rows={3}
            style={{ width: '100%', resize: 'vertical' }}
            disabled={submitting}
          />
          {showMentionDropdown && mentionCandidates.length > 0 && (
            <ul
              className="race-score-list"
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                marginBottom: '0.25rem',
                maxHeight: '120px',
                overflowY: 'auto',
                listStyle: 'none',
                padding: '0.35rem',
                zIndex: 10,
              }}
            >
              {mentionCandidates.slice(0, 8).map((m) => (
                <li key={m.uid}>
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ width: '100%', textAlign: 'left' }}
                    onClick={() => insertMention(m)}
                  >
                    {m.displayName || m.uid}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={submitMessage} disabled={submitting || !composerText.trim()}>
            {submitting ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </section>
  )
}

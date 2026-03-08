import { signOut } from 'firebase/auth'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { auth } from '../lib/firebase'
import { ThemeToggle } from './ThemeToggle'

const baseLinks = [
  { to: '/app', label: 'Dashboard' },
  { to: '/app/picks', label: 'Picks' },
  { to: '/app/messages', label: 'Messages' },
  { to: '/app/leaderboard', label: 'Leaderboard' },
  { to: '/how-to-use', label: 'How To Use' },
]

export function AppLayout() {
  const { profile, groups, activeGroupId, currentGroupRole } = useAuth()
  const activeGroup = groups.find((group) => group.id === activeGroupId)
  const activeGroupLabel = activeGroup?.name ?? activeGroupId ?? 'No group selected'

  const links =
    currentGroupRole === 'owner' || currentGroupRole === 'admin'
      ? [...baseLinks, { to: '/app/admin', label: 'Admin' }]
      : baseLinks

  const handleSignOut = async () => {
    await signOut(auth)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>F1 Fantasy</h1>
          <p>Firebase-backed league picks and scoring</p>
          <p>
            Active group: <strong>{activeGroupLabel}</strong>{' '}
            <Link to="/groups" className="inline-link">
              Change
            </Link>
          </p>
        </div>

        <div className="header-actions">
          <ThemeToggle />

          <nav>
            <ul className="app-nav">
              {links.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                    end={link.to === '/app'}
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="user-actions">
            <span className="user-pill">{profile?.displayName ?? profile?.email ?? 'Signed in'}</span>
            <button type="button" className="secondary-btn" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  )
}

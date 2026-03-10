import { useState } from 'react'
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
  { to: '/app/stats', label: 'Stats' },
  { to: '/how-to-use', label: 'How To Use' },
]

export function AppLayout() {
  const { profile, groups, activeGroupId, currentGroupRole } = useAuth()
  const activeGroup = groups.find((group) => group.id === activeGroupId)
  const activeGroupLabel = activeGroup?.name ?? activeGroupId ?? 'No group selected'
  const [sideNavOpen, setSideNavOpen] = useState(false)

  const links =
    currentGroupRole === 'owner' || currentGroupRole === 'admin'
      ? [...baseLinks, { to: '/app/admin', label: 'Admin' }]
      : baseLinks

  const handleSignOut = async () => {
    await signOut(auth)
  }

  const closeSideNav = () => setSideNavOpen(false)

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <h1>F1 Fantasy</h1>
          <p className="header-subtitle">Firebase-backed league picks and scoring</p>
          <p className="header-group">
            Active group: <strong>{activeGroupLabel}</strong>{' '}
            <Link to="/groups" className="inline-link" onClick={closeSideNav}>
              Change
            </Link>
          </p>
        </div>

        <button
          type="button"
          className="header-menu-btn"
          onClick={() => setSideNavOpen(true)}
          aria-label="Open menu"
        >
          <span className="header-menu-icon" aria-hidden />
        </button>
      </header>

      <div
        className={`side-nav-overlay ${sideNavOpen ? 'side-nav-overlay-open' : ''}`}
        onClick={closeSideNav}
        onKeyDown={(e) => e.key === 'Escape' && closeSideNav()}
        role="button"
        tabIndex={-1}
        aria-hidden={sideNavOpen ? 'false' : 'true'}
        aria-label="Close menu"
      />
      <aside
        className={`side-nav-panel ${sideNavOpen ? 'side-nav-panel-open' : ''}`}
        aria-label="Main navigation"
      >
        <div className="side-nav-header">
          <span className="side-nav-title">Menu</span>
          <button
            type="button"
            className="side-nav-close"
            onClick={closeSideNav}
            aria-label="Close menu"
          >
            ×
          </button>
        </div>
        <p className="side-nav-group">
          <strong>{activeGroupLabel}</strong>
          <Link to="/groups" className="inline-link" onClick={closeSideNav}>
            Change group
          </Link>
        </p>
        <nav className="side-nav-links">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => (isActive ? 'side-nav-link active' : 'side-nav-link')}
              end={link.to === '/app'}
              onClick={closeSideNav}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-nav-footer">
          <div className="side-nav-theme">
            <ThemeToggle />
          </div>
          <span className="user-pill side-nav-user">{profile?.displayName ?? profile?.email ?? 'Signed in'}</span>
          <button type="button" className="secondary-btn side-nav-signout" onClick={() => { closeSideNav(); handleSignOut(); }}>
            Sign out
          </button>
        </div>
      </aside>

      <main>
        <Outlet />
      </main>
    </div>
  )
}

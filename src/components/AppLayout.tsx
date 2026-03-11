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

  const renderNavContent = (isDrawer = false) => (
    <>
      <div className="shell-brand">
        <div className="shell-brand-mark">F1</div>
        <div>
          <div className="shell-brand-title">F1 Total</div>
          <div className="shell-brand-subtitle">Fantasy league control room</div>
        </div>
      </div>

      <div className="shell-group-card">
        <span className="shell-group-label">Active group</span>
        <strong>{activeGroupLabel}</strong>
        <Link to="/groups" className="inline-link" onClick={closeSideNav}>
          Change group
        </Link>
      </div>

      <nav className="shell-nav">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => (isActive ? 'shell-nav-link active' : 'shell-nav-link')}
            end={link.to === '/app'}
            onClick={isDrawer ? closeSideNav : undefined}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <div className="shell-footer">
        <div className="shell-theme-wrap">
          <ThemeToggle />
        </div>
        <span className="user-pill shell-user-pill">{profile?.displayName ?? profile?.email ?? 'Signed in'}</span>
        <button
          type="button"
          className="secondary-btn shell-signout"
          onClick={() => {
            if (isDrawer) closeSideNav()
            void handleSignOut()
          }}
        >
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="app-shell">
      <aside className="app-sidebar-desktop" aria-label="Main navigation">
        {renderNavContent()}
      </aside>

      <div className="app-main-column">
        <header className="app-header">
          <div className="header-brand">
            <p className="header-kicker">Race Week Control Room</p>
            <h1>F1 Fantasy</h1>
            <p className="header-subtitle">Track your current group, picks, standings, and race status in one place.</p>
          </div>

          <div className="header-actions">
            <div className="header-group-pill">
              <span>Group</span>
              <strong>{activeGroupLabel}</strong>
            </div>
            <button
              type="button"
              className="header-menu-btn"
              onClick={() => setSideNavOpen(true)}
              aria-label="Open menu"
            >
              <span className="header-menu-icon" aria-hidden />
            </button>
          </div>
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
          <div className="side-nav-scroll">{renderNavContent(true)}</div>
        </aside>

        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

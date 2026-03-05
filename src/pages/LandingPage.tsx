import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { ThemeToggle } from '../components/ThemeToggle'

const features = [
  {
    title: 'Create Or Join Leagues',
    description: 'Start your own F1 group or request access to an existing one with an invite code.',
  },
  {
    title: 'Group-Based Leaderboards',
    description: 'Every group has isolated picks, scores, and rankings with up/down movement tracking.',
  },
  {
    title: 'Configurable Scoring',
    description: 'Scoring rules can be adjusted by admins, including optional DNF penalties and movement bonuses.',
  },
]

const howItWorks = [
  'Sign in with Google.',
  'Create a group or submit a join request with an invite code.',
  'Group admins approve requests and manage member roles.',
  'Submit race picks before lock time and climb the leaderboard.',
]

export function LandingPage() {
  const { user } = useAuth()

  return (
    <div className="landing-page">
      <div className="page-theme-toggle">
        <ThemeToggle />
      </div>
      <header className="landing-hero">
        <div className="landing-hero-content">
          <img src="/f1_total_logo.png" alt="F1 Total logo" className="brand-logo" />
          <p className="landing-kicker">F1 Fantasy League Platform</p>
          <h1>Build private racing leagues with controlled access and live rankings.</h1>
          <p>
            F1 Total is a multi-group fantasy app where each league is isolated, invite-driven, and admin-managed.
          </p>

          <div className="landing-actions">
            <Link to={user ? '/app' : '/login'} className="landing-btn primary">
              {user ? 'Open App' : 'Start With Google'}
            </Link>
            <Link to="/groups" className="landing-btn secondary">
              Join Or Create Group
            </Link>
          </div>
        </div>
      </header>

      <section className="landing-section">
        <h2>Key Features</h2>
        <div className="feature-grid">
          {features.map((feature) => (
            <article key={feature.title} className="feature-card">
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <h2>How To Use</h2>
        <ol className="how-list">
          {howItWorks.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
    </div>
  )
}

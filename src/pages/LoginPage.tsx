import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { ThemeToggle } from '../components/ThemeToggle'
import { auth } from '../lib/firebase'

const googleProvider = new GoogleAuthProvider()

const highlights = [
  'Private group leagues with invite-only access',
  'Approval workflow before users enter your group',
  'Live leaderboard movement after every scoring run',
]

export function LoginPage() {
  const { user, loading } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!loading && user) {
    return <Navigate to="/groups" replace />
  }

  const onGoogleSignIn = async () => {
    setSubmitting(true)
    setError(null)

    try {
      await signInWithPopup(auth, googleProvider)
    } catch (googleError) {
      const message = googleError instanceof Error ? googleError.message : 'Google sign-in failed'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="page-theme-toggle">
        <ThemeToggle />
      </div>
      <div className="login-shell">
        <section className="login-hero-panel">
          <img src="/f1_total_logo.png" alt="F1 Total logo" className="brand-logo" />
          <p className="landing-kicker">F1 Total Access</p>
          <h1>Sign in to race your friends in private fantasy leagues.</h1>
          <p>
            Use your Google account to access your groups, submit race picks before lock, and track championship
            movement.
          </p>

          <ul className="login-highlights">
            {highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <Link to="/" className="inline-link">
            Back to landing page
          </Link>
        </section>

        <section className="auth-card login-auth-card">
          <h2>Continue With Google</h2>
          <p>One click sign-in. Then create a group or request to join with an invite code.</p>

          <button type="button" className="landing-btn primary" onClick={onGoogleSignIn} disabled={submitting}>
            {submitting ? 'Working...' : 'Sign in with Google'}
          </button>

          {error ? <p className="validation-error">{error}</p> : null}
        </section>
      </div>
    </div>
  )
}

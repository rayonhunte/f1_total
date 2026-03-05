import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

import type { ReactElement } from 'react'

type RequireAuthProps = {
  children: ReactElement
}

export function RequireAuth({ children }: RequireAuthProps) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="app-shell">
        <section>
          <h2>Loading account...</h2>
          <p>Checking authentication state.</p>
        </section>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}

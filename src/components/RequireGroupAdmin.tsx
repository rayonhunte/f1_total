import type { ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

type RequireGroupAdminProps = {
  children: ReactElement
}

export function RequireGroupAdmin({ children }: RequireGroupAdminProps) {
  const { loading, currentGroupRole } = useAuth()

  if (loading) {
    return (
      <section>
        <h2>Loading account...</h2>
        <p>Checking group admin access.</p>
      </section>
    )
  }

  if (currentGroupRole !== 'owner' && currentGroupRole !== 'admin') {
    return <Navigate to="/app" replace />
  }

  return children
}

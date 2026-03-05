import type { ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

type RequireGroupProps = {
  children: ReactElement
}

export function RequireGroup({ children }: RequireGroupProps) {
  const { loading, activeGroupId } = useAuth()

  if (loading) {
    return (
      <div className="app-shell">
        <section>
          <h2>Loading groups...</h2>
          <p>Checking your group memberships.</p>
        </section>
      </div>
    )
  }

  if (!activeGroupId) {
    return <Navigate to="/groups" replace />
  }

  return children
}

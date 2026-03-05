import type { ReactElement } from 'react'

// Backward-compatible shim. New routes should use RequireGroupAdmin.
export function RequireAdmin({ children }: { children: ReactElement }) {
  return children
}

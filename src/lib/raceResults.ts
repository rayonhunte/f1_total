export function isDidNotFinishStatus(status: string | undefined | null): boolean {
  const normalized = String(status ?? '').trim()

  if (!normalized) return false
  if (/^finished$/i.test(normalized)) return false
  if (/^lapped$/i.test(normalized)) return false
  if (/^\+\d+\s+laps?$/i.test(normalized)) return false
  if (/^\+\d+(?::\d{1,2})?\.\d+$/i.test(normalized)) return false

  return true
}

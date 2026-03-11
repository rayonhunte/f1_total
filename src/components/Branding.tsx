import type { CSSProperties } from 'react'
import { countryCodeToFlagEmoji, getRaceCountryCode, getTeamBrand } from '../lib/branding'

export function TeamLogo({ constructorId, name, size = 'md' }: { constructorId: string; name?: string; size?: 'sm' | 'md' }) {
  const brand = getTeamBrand(constructorId, name)

  return (
    <span
      className={`team-logo team-logo-${size}`}
      style={
        {
          '--team-bg': brand.bg,
          '--team-fg': brand.fg,
          '--team-ring': brand.ring,
        } as CSSProperties
      }
      aria-label={name ?? brand.label}
      title={name ?? brand.label}
    >
      {brand.short}
    </span>
  )
}

export function CountryFlag({
  raceName,
  size = 'md',
}: {
  raceName: string
  size?: 'sm' | 'md'
}) {
  const code = getRaceCountryCode(raceName)
  const emoji = countryCodeToFlagEmoji(code)

  if (!emoji) return null

  return (
    <span className={`country-flag country-flag-${size}`} aria-label={code ?? raceName} title={raceName}>
      {emoji}
    </span>
  )
}

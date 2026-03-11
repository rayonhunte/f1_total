type TeamBrand = {
  label: string
  short: string
  bg: string
  fg: string
  ring: string
}

const TEAM_BRANDS: Record<string, TeamBrand> = {
  red_bull: { label: 'Red Bull', short: 'RB', bg: '#1e3a8a', fg: '#f8fafc', ring: '#facc15' },
  mercedes: { label: 'Mercedes', short: 'M', bg: '#0f766e', fg: '#ecfeff', ring: '#5eead4' },
  ferrari: { label: 'Ferrari', short: 'F', bg: '#b91c1c', fg: '#fff7ed', ring: '#facc15' },
  mclaren: { label: 'McLaren', short: 'M', bg: '#ea580c', fg: '#fff7ed', ring: '#fdba74' },
  aston_martin: { label: 'Aston Martin', short: 'AM', bg: '#14532d', fg: '#ecfdf5', ring: '#86efac' },
  alpine: { label: 'Alpine', short: 'A', bg: '#1d4ed8', fg: '#eff6ff', ring: '#93c5fd' },
  williams: { label: 'Williams', short: 'W', bg: '#2563eb', fg: '#eff6ff', ring: '#bfdbfe' },
  haas: { label: 'Haas', short: 'H', bg: '#4b5563', fg: '#f9fafb', ring: '#d1d5db' },
  rb: { label: 'Racing Bulls', short: 'RB', bg: '#1e40af', fg: '#eff6ff', ring: '#93c5fd' },
  racing_bulls: { label: 'Racing Bulls', short: 'RB', bg: '#1e40af', fg: '#eff6ff', ring: '#93c5fd' },
  sauber: { label: 'Sauber', short: 'S', bg: '#166534', fg: '#f0fdf4', ring: '#86efac' },
  audi: { label: 'Audi', short: 'A', bg: '#111827', fg: '#f9fafb', ring: '#ef4444' },
  cadillac: { label: 'Cadillac', short: 'C', bg: '#0f172a', fg: '#f8fafc', ring: '#60a5fa' },
}

const RACE_COUNTRY_CODES: Record<string, string> = {
  'Australian Grand Prix': 'AU',
  'Chinese Grand Prix': 'CN',
  'Japanese Grand Prix': 'JP',
  'Bahrain Grand Prix': 'BH',
  'Saudi Arabian Grand Prix': 'SA',
  'Miami Grand Prix': 'US',
  'Canadian Grand Prix': 'CA',
  'Monaco Grand Prix': 'MC',
  'Barcelona Grand Prix': 'ES',
  'Spanish Grand Prix': 'ES',
  'Austrian Grand Prix': 'AT',
  'British Grand Prix': 'GB',
  'Belgian Grand Prix': 'BE',
  'Hungarian Grand Prix': 'HU',
  'Dutch Grand Prix': 'NL',
  'Italian Grand Prix': 'IT',
  'Azerbaijan Grand Prix': 'AZ',
  'Singapore Grand Prix': 'SG',
  'United States Grand Prix': 'US',
  'Mexico City Grand Prix': 'MX',
  'Brazilian Grand Prix': 'BR',
  'Las Vegas Grand Prix': 'US',
  'Qatar Grand Prix': 'QA',
  'Abu Dhabi Grand Prix': 'AE',
  'Season Opener': 'AU',
}

export function getTeamBrand(constructorId: string, fallbackName?: string): TeamBrand {
  const match = TEAM_BRANDS[constructorId]
  if (match) return match

  const label = fallbackName ?? constructorId
  const short = label
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

  return {
    label,
    short,
    bg: '#334155',
    fg: '#f8fafc',
    ring: '#cbd5e1',
  }
}

export function getRaceCountryCode(raceName: string): string | null {
  return RACE_COUNTRY_CODES[raceName] ?? null
}

export function countryCodeToFlagEmoji(countryCode: string | null | undefined): string {
  if (!countryCode || !/^[A-Za-z]{2}$/.test(countryCode)) return ''
  return countryCode
    .toUpperCase()
    .split('')
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('')
}

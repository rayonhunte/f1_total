export type TeamThemeId =
  | 'dark'
  | 'ferrari'
  | 'alpine'
  | 'aston_martin'
  | 'haas'
  | 'audi'
  | 'cadillac'
  | 'mclaren'
  | 'mercedes'
  | 'racing_bulls'
  | 'redbull'
  | 'williams'

export const TEAM_THEMES: { id: TeamThemeId; label: string }[] = [
  { id: 'dark', label: 'Default' },
  { id: 'ferrari', label: 'Ferrari' },
  { id: 'alpine', label: 'Alpine' },
  { id: 'aston_martin', label: 'Aston Martin' },
  { id: 'haas', label: 'Haas' },
  { id: 'audi', label: 'Audi' },
  { id: 'cadillac', label: 'Cadillac' },
  { id: 'mclaren', label: 'McLaren' },
  { id: 'mercedes', label: 'Mercedes' },
  { id: 'racing_bulls', label: 'Racing Bulls' },
  { id: 'redbull', label: 'Red Bull Racing' },
  { id: 'williams', label: 'Williams' },
]

export const VALID_THEME_IDS = new Set<string>(TEAM_THEMES.map((t) => t.id))

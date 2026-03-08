import { createContext } from 'react'
import type { TeamThemeId } from './teamThemes'

export type { TeamThemeId }

export type ThemeContextValue = {
  mode: TeamThemeId
  setMode: (mode: TeamThemeId) => void
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

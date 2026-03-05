import { createContext } from 'react'

export type ThemeMode = 'light' | 'dark'

export type ThemeContextValue = {
  mode: ThemeMode
  toggleMode: () => void
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

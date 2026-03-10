import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ThemeContext } from './ThemeContext'
import { VALID_THEME_IDS, type TeamThemeId } from './teamThemes'

const STORAGE_KEY = 'f1_total_theme_mode'

function getInitialMode(): TeamThemeId {
  if (typeof window === 'undefined') return 'dark'

  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved && VALID_THEME_IDS.has(saved)) return saved as TeamThemeId

  return 'dark'
}

type ThemeProviderProps = {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<TeamThemeId>(() => getInitialMode())

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode)
    window.localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  const value = useMemo(
    () => ({
      mode,
      setMode: (next: TeamThemeId) => setModeState(next),
    }),
    [mode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

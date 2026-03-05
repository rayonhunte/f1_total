import { useTheme } from '../theme/useTheme'

export function ThemeToggle() {
  const { mode, toggleMode } = useTheme()

  return (
    <button type="button" className="theme-toggle" onClick={toggleMode} aria-label="Toggle light and dark mode">
      {mode === 'light' ? 'Dark Mode' : 'Light Mode'}
    </button>
  )
}

import { TEAM_THEMES, type TeamThemeId } from '../theme/teamThemes'
import { useTheme } from '../theme/useTheme'

export function ThemeToggle() {
  const { mode, setMode } = useTheme()

  return (
    <select
      className="theme-toggle"
      value={mode}
      onChange={(e) => setMode(e.target.value as TeamThemeId)}
      aria-label="Select team theme"
    >
      {TEAM_THEMES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  )
}

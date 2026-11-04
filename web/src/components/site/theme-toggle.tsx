import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import type { SiteCopy } from "@/content"

const themeOrder = ["system", "light", "dark"] as const

export function ThemeToggle({ t }: { t: SiteCopy }) {
  const { theme, setTheme } = useTheme()
  const ThemeIcon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun
  const nextLabel =
    theme === "system" ? t.themeLight : theme === "light" ? t.themeDark : t.themeSystem

  return (
    <button
      type="button"
      className="theme-control"
      aria-label={`${t.themeLabel}: ${theme === "system" ? t.themeSystem : theme === "light" ? t.themeLight : t.themeDark}. ${nextLabel}`}
      title={theme === "system" ? t.themeSystem : theme === "light" ? t.themeLight : t.themeDark}
      onClick={() => {
        const index = themeOrder.indexOf(theme)
        const next = themeOrder[(index + 1) % themeOrder.length]
        setTheme(next)
      }}
    >
      <ThemeIcon size={16} aria-hidden="true" />
    </button>
  )
}

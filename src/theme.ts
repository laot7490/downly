import { useEffect, useState } from "react"

export type ThemeChoice = "system" | "light" | "dark"

const storageKey = "downly-theme"

export function readTheme(): ThemeChoice {
  const stored = localStorage.getItem(storageKey)
  if (stored === "system" || stored === "light" || stored === "dark") {
    return stored
  }
  return "system"
}

export function resolvedTheme(theme: ThemeChoice): "light" | "dark" {
  if (theme === "light" || theme === "dark") {
    return theme
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function applyTheme(theme: ThemeChoice) {
  const root = document.documentElement
  const resolved = resolvedTheme(theme)
  root.classList.remove("system", "light", "dark")
  root.classList.add(theme)
  if (resolved === "dark") {
    root.classList.add("dark")
  }
  root.style.colorScheme = resolved
}

export function storeTheme(theme: ThemeChoice) {
  localStorage.setItem(storageKey, theme)
  applyTheme(theme)
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeChoice>(() => readTheme())

  useEffect(() => {
    applyTheme(theme)
    if (theme !== "system") {
      return
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => applyTheme("system")
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [theme])

  const chooseTheme = (next: ThemeChoice) => {
    storeTheme(next)
    setTheme(next)
  }

  return { theme, chooseTheme }
}

import { pages, routes, type Language, type Page } from "@/content"

export const languageStorageKey = "downly-web-language"

export function resolveRoute(pathname = window.location.pathname): {
  language: Language
  page: Page | "not-found"
} {
  const path = pathname.replace(/\/+$/, "") || "/"
  for (const language of ["en", "tr"] as const) {
    for (const page of pages) {
      if (routes[language][page] === path) {
        return { language, page }
      }
    }
  }
  return { language: path.startsWith("/tr") ? "tr" : "en", page: "not-found" }
}

export function pathForLanguage(
  page: Page | "not-found",
  language: Language
): string {
  const target = page === "not-found" ? "home" : page
  return routes[language][target]
}

export function readStoredLanguage(): Language | null {
  const stored = localStorage.getItem(languageStorageKey)
  return stored === "en" || stored === "tr" ? stored : null
}

export function storeLanguage(language: Language) {
  localStorage.setItem(languageStorageKey, language)
}

export function detectBrowserLanguage(): Language {
  return navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en"
}

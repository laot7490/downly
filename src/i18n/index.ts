import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import en from "./locales/en.json"
import tr from "./locales/tr.json"

export type Language = "en" | "tr"

const storageKey = "downly-language"

export function detectLanguage(): Language {
  const stored = localStorage.getItem(storageKey)
  if (stored === "en" || stored === "tr") {
    return stored
  }
  const locale = navigator.language.toLowerCase()
  if (locale.startsWith("tr")) {
    return "tr"
  }
  return "en"
}

export function applyLanguage(language: Language) {
  document.documentElement.lang = language
}

const language = detectLanguage()

applyLanguage(language)

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    tr: { translation: tr },
  },
  lng: language,
  fallbackLng: "en",
  supportedLngs: ["en", "tr"],
  interpolation: { escapeValue: false },
})

export function chooseLanguage(next: Language) {
  localStorage.setItem(storageKey, next)
  applyLanguage(next)
  void i18n.changeLanguage(next)
}

export default i18n

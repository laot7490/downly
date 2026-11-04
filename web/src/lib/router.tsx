import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  detectBrowserLanguage,
  pathForLanguage,
  readStoredLanguage,
  resolveRoute,
} from "@/lib/site"
import type { Language, Page } from "@/content"

type RouteState = {
  language: Language
  page: Page | "not-found"
  pathname: string
}

type RouterContextValue = RouteState & {
  navigate: (to: string, options?: { replace?: boolean }) => void
}

const RouterContext = createContext<RouterContextValue | null>(null)

function readRoute(): RouteState {
  const pathname = window.location.pathname
  return { ...resolveRoute(pathname), pathname }
}

function redirectToLanguage(route: RouteState, language: Language): RouteState {
  if (language === route.language) {
    return route
  }
  const nextPath = pathForLanguage(route.page, language)
  window.history.replaceState(null, "", nextPath)
  return { ...resolveRoute(nextPath), pathname: nextPath }
}

function initialRoute(): RouteState {
  const route = readRoute()
  const stored = readStoredLanguage()
  if (stored) {
    return redirectToLanguage(route, stored)
  }
  if (detectBrowserLanguage() === "tr" && route.language === "en") {
    return redirectToLanguage(route, "tr")
  }
  return route
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<RouteState>(() => initialRoute())

  const navigate = useCallback(
    (to: string, options?: { replace?: boolean }) => {
      const url = new URL(to, window.location.href)
      const nextPath = `${url.pathname}${url.search}${url.hash}`
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const samePage =
        url.pathname === window.location.pathname &&
        url.search === window.location.search

      if (nextPath === current) {
        if (url.hash) {
          document.getElementById(url.hash.slice(1))?.scrollIntoView()
        }
        return
      }

      if (options?.replace) {
        window.history.replaceState(null, "", nextPath)
      } else {
        window.history.pushState(null, "", nextPath)
      }

      if (!samePage) {
        setRoute(readRoute())
      }

      if (url.hash) {
        requestAnimationFrame(() => {
          document.getElementById(url.hash.slice(1))?.scrollIntoView()
        })
        return
      }

      window.scrollTo(0, 0)
    },
    []
  )

  useEffect(() => {
    const onPopState = () => {
      setRoute(readRoute())
      window.scrollTo({ top: 0, left: 0 })
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  const value = useMemo(
    () => ({
      ...route,
      navigate,
    }),
    [route, navigate]
  )

  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  )
}

export function useRouter() {
  const context = useContext(RouterContext)
  if (!context) {
    throw new Error("useRouter must be used within a RouterProvider")
  }
  return context
}

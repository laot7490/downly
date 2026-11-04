import { useEffect, useState } from "react"
import {
  readCachedSetupUrl,
  releasesPageUrl,
  resolveSetupDownloadUrl,
} from "@/lib/release"

function scheduleIdle(callback: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 2500 })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(callback, 0)
  return () => window.clearTimeout(id)
}

export function useSetupDownloadUrl() {
  const [url, setUrl] = useState(
    () => readCachedSetupUrl() ?? releasesPageUrl
  )

  useEffect(() => {
    let active = true
    const cancelIdle = scheduleIdle(() => {
      void resolveSetupDownloadUrl().then((next) => {
        if (active) {
          setUrl(next)
        }
      })
    })
    return () => {
      active = false
      cancelIdle()
    }
  }, [])

  return url
}

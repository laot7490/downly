export const releasesPageUrl =
  "https://github.com/laot7490/downly/releases/latest"

const setupUrlStorageKey = "downly-web-setup-url"

const latestReleaseApi =
  "https://api.github.com/repos/laot7490/downly/releases/latest"

type GithubAsset = {
  name: string
  browser_download_url: string
}

type GithubRelease = {
  assets?: GithubAsset[]
}

let cachedSetupUrl: Promise<string> | null = null

function pickSetupAsset(assets: GithubAsset[] | undefined) {
  if (!assets?.length) {
    return null
  }
  return (
    assets.find((asset) => /x64-setup\.exe$/i.test(asset.name)) ??
    assets.find((asset) => /-setup\.exe$/i.test(asset.name)) ??
    null
  )
}

export function readCachedSetupUrl(): string | null {
  try {
    const value = sessionStorage.getItem(setupUrlStorageKey)
    if (!value || value === releasesPageUrl) {
      return null
    }
    return value
  } catch {
    return null
  }
}

export function writeCachedSetupUrl(url: string) {
  if (!url || url === releasesPageUrl) {
    return
  }
  try {
    sessionStorage.setItem(setupUrlStorageKey, url)
  } catch {
    // ignore quota / private mode
  }
}

export function resolveSetupDownloadUrl(): Promise<string> {
  if (!cachedSetupUrl) {
    const stored = readCachedSetupUrl()
    if (stored) {
      cachedSetupUrl = Promise.resolve(stored)
      return cachedSetupUrl
    }

    cachedSetupUrl = fetch(latestReleaseApi, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`release lookup failed (${response.status})`)
        }
        return (await response.json()) as GithubRelease
      })
      .then((release) => {
        const asset = pickSetupAsset(release.assets)
        if (!asset?.browser_download_url) {
          throw new Error("setup asset missing")
        }
        writeCachedSetupUrl(asset.browser_download_url)
        return asset.browser_download_url
      })
      .catch(() => releasesPageUrl)
  }
  return cachedSetupUrl
}

import { useEffect } from "react"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteNav } from "@/components/site/site-nav"
import { content, pages } from "@/content"
import { useRouter } from "@/lib/router"
import { FaqPage } from "@/pages/faq-page"
import { HomePage } from "@/pages/home-page"
import { InstallPage } from "@/pages/install-page"
import { LicensePage } from "@/pages/license-page"
import { NotFoundPage } from "@/pages/not-found-page"
import { PrivacyPage } from "@/pages/privacy-page"

function App() {
  const { language, page } = useRouter()
  const t = content[language]
  const pageIndex = page === "not-found" ? 0 : pages.indexOf(page)

  useEffect(() => {
    const title =
      page === "home"
        ? `Downly — ${t.heroLines.join(" ")}`
        : page === "not-found"
          ? `Downly — ${t.notFound[0]}`
          : `${t.pageTitles[pageIndex]} — Downly`
    const description =
      page === "home"
        ? t.intro
        : page === "not-found"
          ? t.notFound[1]
          : t.pageIntros[pageIndex]

    document.documentElement.lang = language
    document.title = title

    for (const [selector, value] of [
      ['meta[name="description"]', description],
      ['meta[property="og:title"]', title],
      ['meta[property="og:description"]', description],
      ['meta[name="twitter:title"]', title],
      ['meta[name="twitter:description"]', description],
    ] as const) {
      document.querySelector(selector)?.setAttribute("content", value)
    }

    document
      .querySelector('link[rel="canonical"]')
      ?.setAttribute(
        "href",
        `https://downly.emirgenc.com.tr${window.location.pathname}`
      )
  }, [language, page, pageIndex, t])

  return (
    <div className="site-shell">
      <a href="#main" className="skip-link">
        {t.skip}
      </a>
      <SiteNav language={language} page={page} t={t} />
      <main id="main">
        {page === "home" && <HomePage t={t} />}
        {page === "faq" && <FaqPage t={t} />}
        {page === "install" && <InstallPage t={t} />}
        {page === "privacy" && <PrivacyPage t={t} />}
        {page === "license" && <LicensePage t={t} />}
        {page === "not-found" && <NotFoundPage language={language} t={t} />}
      </main>
      <SiteFooter language={language} t={t} />
    </div>
  )
}

export default App

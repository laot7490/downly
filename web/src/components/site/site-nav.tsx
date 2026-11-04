import { useState } from "react"
import { ArrowRight, Download, Menu } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { BrandMark } from "@/components/site/brand"
import { DownloadButton } from "@/components/site/download-button"
import { LangSwitch } from "@/components/site/lang-switch"
import { SiteLink } from "@/components/site/site-link"
import { ThemeToggle } from "@/components/site/theme-toggle"
import {
  pages,
  routes,
  type Language,
  type Page,
  type SiteCopy,
} from "@/content"
import { useSetupDownloadUrl } from "@/hooks/use-setup-download-url"

export function SiteNav({
  language,
  page,
  t,
}: {
  language: Language
  page: Page | "not-found"
  t: SiteCopy
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const setupUrl = useSetupDownloadUrl()

  return (
    <header className="site-header">
      <div className="site-container header-inner">
        <SiteLink
          className="brand"
          href={routes[language].home}
          aria-label={`Downly — ${t.nav[0]}`}
        >
          <BrandMark />
        </SiteLink>
        <nav className="desktop-nav" aria-label={t.navLabel}>
          {pages.map((item, index) => (
            <SiteLink
              key={item}
              href={routes[language][item]}
              aria-current={page === item ? "page" : undefined}
            >
              {t.nav[index]}
            </SiteLink>
          ))}
        </nav>
        <div className="header-actions">
          <LangSwitch language={language} page={page} t={t} />
          <ThemeToggle t={t} />
          <a
            className="header-icon-btn"
            href={setupUrl}
            aria-label={t.download}
            title={t.download}
          >
            <Download size={16} aria-hidden="true" />
          </a>
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger className="menu-trigger" aria-label={t.menu}>
              <Menu size={20} aria-hidden="true" />
            </SheetTrigger>
            <SheetContent side="right" className="mobile-sheet">
              <SheetHeader>
                <SheetTitle className="mobile-sheet-brand">
                  <BrandMark />
                  <span className="sr-only">Downly</span>
                </SheetTitle>
              </SheetHeader>
              <nav className="mobile-nav" aria-label={t.navLabel}>
                {pages.map((item, index) => (
                  <SiteLink
                    key={item}
                    href={routes[language][item]}
                    aria-current={page === item ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    {t.nav[index]}
                    <ArrowRight size={16} aria-hidden="true" />
                  </SiteLink>
                ))}
              </nav>
              <DownloadButton label={t.download} />
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

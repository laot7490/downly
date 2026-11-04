import { SiteLink } from "@/components/site/site-link"
import { routes, type Language, type Page, type SiteCopy } from "@/content"
import { storeLanguage } from "@/lib/site"

export function LangSwitch({
  language,
  page,
  t,
}: {
  language: Language
  page: Page | "not-found"
  t: SiteCopy
}) {
  const target = page === "not-found" ? "home" : page

  return (
    <div className="languages" aria-label={t.languageLabel}>
      <SiteLink
        href={routes.en[target]}
        lang="en"
        aria-current={language === "en" ? "true" : undefined}
        onClick={() => storeLanguage("en")}
      >
        EN
      </SiteLink>
      <span>/</span>
      <SiteLink
        href={routes.tr[target]}
        lang="tr"
        aria-current={language === "tr" ? "true" : undefined}
        onClick={() => storeLanguage("tr")}
      >
        TR
      </SiteLink>
    </div>
  )
}

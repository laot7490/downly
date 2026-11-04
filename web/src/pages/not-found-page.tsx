import { ArrowRight } from "lucide-react"
import { SiteLink } from "@/components/site/site-link"
import { routes, type Language, type SiteCopy } from "@/content"

export function NotFoundPage({
  language,
  t,
}: {
  language: Language
  t: SiteCopy
}) {
  return (
    <div className="inner-page site-container not-found">
      <h1>{t.notFound[0]}</h1>
      <p>{t.notFound[1]}</p>
      <SiteLink href={routes[language].home} className="download-button">
        {t.notFound[2]}
        <ArrowRight size={16} aria-hidden="true" />
      </SiteLink>
    </div>
  )
}

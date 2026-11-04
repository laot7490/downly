import { Brand } from "@/components/site/brand"
import { ExternalLink } from "@/components/site/external-link"
import { SiteLink } from "@/components/site/site-link"
import { pages, repoUrl, routes, type Language, type SiteCopy } from "@/content"

export function SiteFooter({
  language,
  t,
}: {
  language: Language
  t: SiteCopy
}) {
  return (
    <footer className="site-footer">
      <div className="site-container footer-inner">
        <div className="footer-brand">
          <Brand />
          <p>{t.footer}</p>
        </div>
        <div className="footer-links">
          <nav aria-label={t.footerNavLabel}>
            {pages.slice(1).map((item) => (
              <SiteLink key={item} href={routes[language][item]}>
                {t.nav[pages.indexOf(item)]}
              </SiteLink>
            ))}
          </nav>
          <ExternalLink href={repoUrl} className="footer-source">
            {t.source}
          </ExternalLink>
        </div>
      </div>
    </footer>
  )
}

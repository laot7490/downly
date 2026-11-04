import { ExternalLink } from "@/components/site/external-link"
import { repoUrl, type SiteCopy } from "@/content"

export function PrivacyPage({ t }: { t: SiteCopy }) {
  return (
    <div className="inner-page site-container">
      <div className="page-heading">
        <h1>{t.pageTitles[3]}</h1>
        <p>{t.pageIntros[3]}</p>
      </div>
      <div className="prose-sections">
        {t.privacy.map(([title, body], index) => (
          <section key={title}>
            <h2>{title}</h2>
            <p>{body}</p>
            {index === 2 && (
              <ExternalLink href={`${repoUrl}/issues`}>
                {t.contactLink}
              </ExternalLink>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

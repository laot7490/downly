import { ExternalLink } from "@/components/site/external-link"
import { repoUrl, type SiteCopy } from "@/content"

export function LicensePage({ t }: { t: SiteCopy }) {
  return (
    <div className="inner-page site-container">
      <div className="page-heading">
        <h1>{t.pageTitles[4]}</h1>
        <p>{t.pageIntros[4]}</p>
      </div>
      <div className="prose-sections">
        {t.license.map(([title, body], index) => (
          <section key={title}>
            <h2>{title}</h2>
            <p>{body}</p>
            {index === 0 ? (
              <ExternalLink href={`${repoUrl}/blob/master/LICENSE`}>
                {t.licenseLinks[0]}
              </ExternalLink>
            ) : (
              <div className="link-row">
                <ExternalLink href="https://github.com/yt-dlp/yt-dlp">
                  {t.licenseLinks[1]}
                </ExternalLink>
                <ExternalLink href="https://ffmpeg.org/legal.html">
                  {t.licenseLinks[2]}
                </ExternalLink>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

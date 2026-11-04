import { Download } from "lucide-react"
import { useSetupDownloadUrl } from "@/hooks/use-setup-download-url"
import type { SiteCopy } from "@/content"

export function InstallPage({ t }: { t: SiteCopy }) {
  const setupUrl = useSetupDownloadUrl()

  return (
    <div className="inner-page site-container">
      <div className="page-heading">
        <h1>{t.pageTitles[2]}</h1>
        <p>{t.pageIntros[2]}</p>
      </div>
      <div className="install-list">
        {t.install.map(([title, body], index) => (
          <article className="install-step" key={title}>
            <span>0{index + 1}</span>
            <div>
              <h2>{title}</h2>
              <p>{body}</p>
              {index === 0 && (
                <a href={setupUrl} className="inline-link">
                  <Download size={14} aria-hidden="true" />
                  {t.releaseLink}
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
      <aside className="notice">
        <h2>{t.warningTitle}</h2>
        <p>{t.warning}</p>
      </aside>
      <p className="rights-note">{t.rights}</p>
    </div>
  )
}

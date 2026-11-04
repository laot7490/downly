import { ArrowRight, Check } from "lucide-react"
import { DownloadButton } from "@/components/site/download-button"
import { SiteLink } from "@/components/site/site-link"
import type { SiteCopy } from "@/content"

export function Hero({ t }: { t: SiteCopy }) {
  return (
    <section className="hero site-container">
      <div className="hero-copy">
        <h1 className="hero-title">
          {t.heroLines.map((line, index) => (
            <span
              key={line}
              className="hero-line"
              style={{ ["--reveal-delay" as string]: `${index * 70}ms` }}
            >
              {line}
            </span>
          ))}
        </h1>
        <p className="hero-lede">{t.intro}</p>
        <div className="hero-actions">
          <DownloadButton label={t.download} />
          <SiteLink className="text-link" href="#how-it-works">
            {t.howLink}
            <ArrowRight size={16} aria-hidden="true" />
          </SiteLink>
        </div>
        <p className="hero-note">
          <Check size={14} aria-hidden="true" />
          {t.heroNote}
        </p>
      </div>
    </section>
  )
}

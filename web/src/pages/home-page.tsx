import { Check, Link2, ListChecks, SlidersHorizontal } from "lucide-react"
import { DownloadButton } from "@/components/site/download-button"
import { Hero } from "@/components/site/hero"
import { ProductFrame } from "@/components/site/product-frame"
import type { SiteCopy } from "@/content"

const icons = [Link2, SlidersHorizontal, ListChecks]

export function HomePage({ t }: { t: SiteCopy }) {
  return (
    <>
      <Hero t={t} />
      <ProductFrame t={t} />
      <section className="section-flow" id="how-it-works">
        <div className="site-container">
          <div className="section-heading">
            <h2>{t.flowTitle}</h2>
            <p>{t.flowIntro}</p>
          </div>
          <div className="steps">
            {t.steps.map(([title, body], index) => {
              const Icon = icons[index]
              return (
                <article key={title} className="step">
                  <span className="step-number">0{index + 1}</span>
                  <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              )
            })}
          </div>
        </div>
      </section>
      <section className="features-section site-container">
        <div className="feature-heading">
          <h2>{t.featuresTitle}</h2>
          <p>{t.supported}</p>
        </div>
        <div className="feature-list">
          {t.features.map(([title, body]) => (
            <article className="feature-row" key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
              <Check size={16} aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>
      <section className="closing site-container">
        <div>
          <h2>{t.ready}</h2>
          <p>{t.readyBody}</p>
        </div>
        <DownloadButton label={t.download} />
      </section>
    </>
  )
}

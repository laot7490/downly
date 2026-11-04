import { AppMock } from "@/components/site/app-mock"
import type { SiteCopy } from "@/content"

export function ProductFrame({ t }: { t: SiteCopy }) {
  return (
    <div className="product-band">
      <div className="product-frame" role="img" aria-label={t.screenshotAlt}>
        <AppMock t={t} />
      </div>
      <p className="image-caption">{t.screenshot}</p>
    </div>
  )
}

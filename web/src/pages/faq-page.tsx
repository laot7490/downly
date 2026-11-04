import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { DownloadButton } from "@/components/site/download-button"
import type { SiteCopy } from "@/content"

export function FaqPage({ t }: { t: SiteCopy }) {
  return (
    <div className="inner-page site-container">
      <div className="page-heading">
        <h1>{t.pageTitles[1]}</h1>
        <p>{t.pageIntros[1]}</p>
      </div>
      <Accordion className="faq-list">
        {t.faq.map(([question, answer]) => (
          <AccordionItem key={question} value={question}>
            <AccordionTrigger className="faq-trigger">
              {question}
            </AccordionTrigger>
            <AccordionContent className="faq-answer">
              <p>{answer}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      <div className="page-cta">
        <p>{t.readyBody}</p>
        <DownloadButton label={t.download} />
      </div>
    </div>
  )
}

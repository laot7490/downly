import { Fragment } from "react"
import {
  ClipboardPaste,
  Clock,
  Download,
  EllipsisVertical,
  Link2,
  Link as LinkIcon,
  ListVideo,
  Minus,
  Play,
  Settings,
  Square,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import brandMarkDark from "../../../../src/assets/brand/icon_white_transparent.png?url"
import type { SiteCopy } from "@/content"

const toggleBase =
  "inline-flex shrink-0 items-center justify-center gap-1 rounded-lg text-sm font-medium whitespace-nowrap transition-all aria-pressed:bg-muted data-[state=on]:bg-muted [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
const toggleSmall =
  "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5"
const badgeBase =
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap"

export function AppMock({ t }: { t: SiteCopy }) {
  const m = t.appMock

  return (
    <div className="app-mock pointer-events-none" aria-hidden="true">
      <div className="flex min-h-[560px] flex-col bg-background text-foreground">
        <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-background px-3">
          <div className="flex h-full min-w-0 items-center gap-2 px-2">
            <img src={brandMarkDark} alt="" className="size-5" width={20} height={20} />
            <span className="text-sm font-semibold tracking-tight">Downly</span>
          </div>
          <nav className="flex h-full items-center gap-4">
            <span className="relative flex h-full items-center gap-2 px-2 text-sm text-foreground after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-white"><Download className="size-4" strokeWidth={1.7} />{m.downloadNav}</span>
            <span className="h-4 w-px bg-border" />
            <span className="flex h-full items-center gap-2 px-2 text-sm text-muted-foreground"><Clock className="size-4" strokeWidth={1.7} />{m.historyNav}</span>
            <span className="h-4 w-px bg-border" />
            <span className="flex h-full items-center gap-2 px-2 text-sm text-muted-foreground"><Settings className="size-4" strokeWidth={1.7} />{m.settingsNav}</span>
          </nav>
          <div className="flex h-full items-center justify-end">
            <span className="inline-flex size-10 items-center justify-center rounded-lg text-foreground"><Minus className="size-4" /></span>
            <span className="inline-flex size-10 items-center justify-center rounded-lg text-foreground"><Square className="size-3.5" /></span>
            <span className="inline-flex size-10 items-center justify-center rounded-lg text-foreground"><X className="size-4" /></span>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
            <div className="flex flex-col gap-4 px-6 py-6 sm:px-8 sm:py-7">
              <section className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                    {m.headline}
                  </h2>
                  <p className="max-w-prose text-sm text-muted-foreground">{m.sub}</p>
                </div>

                <div className="flex w-full flex-col gap-5">
                  <div className="group/field flex w-full flex-col gap-2 *:w-full">
                    <div className="w-fit">
                      <div data-slot="toggle-group" data-size="sm" data-spacing="1" className="group/toggle-group flex w-fit flex-row items-center gap-1 rounded-lg bg-input/30 p-1">
                      <span
                        data-slot="toggle-group-item"
                        data-variant="default"
                        data-spacing="1"
                        data-state="on"
                        aria-pressed="true"
                        className={`${toggleBase} ${toggleSmall} min-w-24 justify-center aria-pressed:bg-background aria-pressed:shadow-xs`}
                      >
                        <Link2 data-icon="inline-start" />
                        {m.single}
                      </span>
                      <span
                        data-slot="toggle-group-item"
                        data-variant="default"
                        data-spacing="1"
                        data-state="off"
                        aria-pressed="false"
                        className={`${toggleBase} ${toggleSmall} min-w-24 justify-center aria-pressed:bg-background aria-pressed:shadow-xs`}
                      >
                        <ListVideo data-icon="inline-start" />
                        {m.multiple}
                      </span>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <div className="relative min-w-0 flex-1">
                        <LinkIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                        <div className="flex h-9 min-w-0 items-center rounded-lg border border-input bg-transparent pr-12 pl-9 text-sm text-muted-foreground dark:bg-input/30 md:text-sm">
                          {m.placeholder}
                        </div>
                        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                          <span className="inline-flex size-7 items-center justify-center rounded-[min(var(--radius-md),12px)] text-muted-foreground">
                            <ClipboardPaste className="size-4" />
                          </span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="lg"
                        tabIndex={-1}
                        className="w-24 shrink-0 opacity-50"
                      >
                        <Download data-icon="inline-start" />
                        {m.add}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium text-foreground">{m.queue}</h3>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        data-slot="toggle-group"
                        data-variant="default"
                        data-size="sm"
                        data-spacing="1"
                        className="group/toggle-group flex w-fit min-w-0 max-w-full flex-row flex-wrap items-center gap-1 rounded-lg bg-input/30 p-1"
                      >
                        {m.filters.map((label, index) => {
                          const active = index === 0
                          return (
                            <Fragment key={label}>
                              <span
                                data-slot="toggle-group-item"
                                data-variant="default"
                                data-state={active ? "on" : "off"}
                                aria-pressed={active}
                                className={`${toggleBase} ${toggleSmall} aria-pressed:bg-background aria-pressed:shadow-xs`}
                              >
                                {label}
                                <span className={`${badgeBase} ${active ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>0</span>
                              </span>
                              {index < m.filters.length - 1 ? <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" /> : null}
                            </Fragment>
                          )
                        })}
                      </div>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="default"
                          tabIndex={-1}
                          className="shrink-0 opacity-50"
                        >
                          <Play data-icon="inline-start" />
                          {m.start}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          tabIndex={-1}
                          className="shrink-0"
                        >
                          <EllipsisVertical />
                        </Button>
                      </div>
                    </div>

                    <div
                      data-slot="empty"
                      className="flex w-full min-w-0 flex-none flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border p-6 text-center text-balance"
                    >
                      <div
                        data-slot="empty-header"
                        className="flex max-w-sm flex-col items-center gap-2"
                      >
                        <div data-slot="empty-icon" className="mb-2 flex shrink-0 items-center justify-center">
                          <img src={brandMarkDark} alt="" className="size-8 opacity-40" width={32} height={32} />
                        </div>
                        <div
                          data-slot="empty-title"
                          className="font-heading text-sm font-medium tracking-tight"
                        >
                          {m.emptyTitle}
                        </div>
                        <div
                          data-slot="empty-description"
                          className="text-sm/relaxed text-muted-foreground"
                        >
                          {m.empty}
                        </div>
                      </div>
                      <div className="flex w-full max-w-lg min-w-0 flex-col items-center gap-2.5 text-sm text-balance">
                        <div className="flex w-full max-w-[25rem] flex-wrap justify-center gap-1.5">
                          {m.sites.map((site) => <span key={site} className="inline-flex h-6 items-center gap-1.5 rounded-4xl bg-secondary px-2 text-[11px] font-medium text-muted-foreground"><span className="flex size-3.5 items-center justify-center rounded-full bg-muted-foreground/20 text-[8px] font-bold">{site[0]}</span>{site}</span>)}
                          <span className="inline-flex h-6 items-center rounded-4xl bg-secondary px-2 text-[11px] font-medium text-muted-foreground">{m.moreSites}</span>
                        </div>
                        <span className="mt-0.5 text-xs font-medium text-primary underline-offset-4">{m.supportedSites}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

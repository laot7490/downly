import {
  BadgeCheck,
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
import type { SiteCopy } from "@/content"

const brandIcon = "/brand/icon-128.png"

const toggleOutline =
  "inline-flex items-center justify-center gap-1 rounded-lg border border-input bg-transparent text-sm font-medium whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
const toggleDefaultSize =
  "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2"
const badgeBase =
  "inline-flex h-5 w-fit shrink-0 items-center justify-center overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap"

export function AppMock({ t }: { t: SiteCopy }) {
  const m = t.appMock

  return (
    <div className="app-mock" aria-hidden="true">
      <div className="flex min-h-[560px] flex-col bg-background text-foreground">
        <header className="flex h-9 shrink-0 items-stretch border-b border-border bg-background">
          <div className="flex min-w-0 flex-1 items-center px-3">
            <img src={brandIcon} alt="" className="size-4" width={16} height={16} />
            <span className="ml-2 text-sm font-semibold tracking-tight">Downly</span>
          </div>
          <div className="flex h-full">
            <span className="inline-flex size-9 items-center justify-center rounded-none text-foreground">
              <Minus className="size-4" />
            </span>
            <span className="inline-flex size-9 items-center justify-center rounded-none text-foreground">
              <Square className="size-3" />
            </span>
            <span className="inline-flex size-9 items-center justify-center rounded-none text-foreground">
              <X className="size-4" />
            </span>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside
            className="flex w-[4.5rem] shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground"
            style={{ ["--sidebar-width" as string]: "4.5rem" }}
          >
            <div className="flex flex-1 flex-col pt-2">
              <div className="flex flex-1 flex-col justify-center px-2">
                <div className="flex flex-col items-center gap-3">
                  <span
                    data-active=""
                    className="flex size-12 items-center justify-center rounded-md bg-sidebar-accent p-0 font-medium text-sidebar-accent-foreground [&_svg]:size-6 [&_svg]:stroke-[1.4]"
                  >
                    <Download />
                  </span>
                  <span className="flex size-12 items-center justify-center rounded-md p-0 text-sidebar-foreground [&_svg]:size-6 [&_svg]:stroke-[1.4]">
                    <Clock />
                  </span>
                  <span className="flex size-12 items-center justify-center rounded-md p-0 text-sidebar-foreground [&_svg]:size-6 [&_svg]:stroke-[1.4]">
                    <Settings />
                  </span>
                </div>
              </div>
              <div className="mt-auto px-2 pb-2">
                <div className="flex flex-col items-center">
                  <span className="flex size-12 items-center justify-center rounded-md p-0 text-muted-foreground [&_svg]:size-4 [&_svg]:stroke-[1.4]">
                    <BadgeCheck />
                  </span>
                </div>
              </div>
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
            <div className="flex flex-col gap-4 p-4 pt-6">
              <section className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                    {m.headline}
                  </h2>
                  <p className="max-w-prose text-sm text-muted-foreground">{m.sub}</p>
                </div>

                <div className="flex w-full flex-col gap-5">
                  <div className="group/field flex w-full flex-col gap-2 *:w-full">
                    <div
                      data-slot="toggle-group"
                      data-variant="outline"
                      data-spacing="0"
                      data-orientation="horizontal"
                      className="group/toggle-group flex w-fit flex-row items-center rounded-lg"
                    >
                      <span
                        data-slot="toggle-group-item"
                        data-variant="outline"
                        data-spacing="0"
                        data-state="on"
                        aria-pressed="true"
                        className={`${toggleOutline} ${toggleDefaultSize} min-w-24 justify-center rounded-none rounded-l-lg border-input bg-muted px-2 has-data-[icon=inline-start]:pl-1.5`}
                      >
                        <Link2 data-icon="inline-start" />
                        {m.single}
                      </span>
                      <span
                        data-slot="toggle-group-item"
                        data-variant="outline"
                        data-spacing="0"
                        className={`${toggleOutline} ${toggleDefaultSize} min-w-24 justify-center rounded-none rounded-r-lg border-l-0 border-input px-2 has-data-[icon=inline-start]:pl-1.5`}
                      >
                        <ListVideo data-icon="inline-start" />
                        {m.multiple}
                      </span>
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
                        data-variant="outline"
                        data-spacing="2"
                        className="group/toggle-group flex min-w-0 w-auto max-w-full flex-1 flex-row flex-wrap items-center gap-2 rounded-lg"
                      >
                        {m.filters.map((label, index) => {
                          const active = index === 0
                          return (
                            <span
                              key={label}
                              data-slot="toggle-group-item"
                              data-variant="outline"
                              data-state={active ? "on" : "off"}
                              aria-pressed={active}
                              className={`${toggleOutline} ${toggleDefaultSize} ${
                                active ? "bg-muted" : ""
                              }`}
                            >
                              {label}
                              <span
                                className={`${badgeBase} ${
                                  active
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-secondary text-secondary-foreground"
                                }`}
                              >
                                0
                              </span>
                            </span>
                          )
                        })}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
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
                      className="flex w-full min-w-0 flex-none flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-6 text-center text-balance"
                    >
                      <div
                        data-slot="empty-header"
                        className="flex max-w-sm flex-col items-center gap-2"
                      >
                        <div data-slot="empty-icon" className="mb-2 flex shrink-0 items-center justify-center">
                          <img
                            src={brandIcon}
                            alt=""
                            className="size-8 opacity-40"
                            width={32}
                            height={32}
                          />
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

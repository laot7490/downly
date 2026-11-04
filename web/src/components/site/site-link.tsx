import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react"
import { useRouter } from "@/lib/router"

type SiteLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string
  children: ReactNode
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  )
}

export function SiteLink({ href, children, onClick, ...props }: SiteLinkProps) {
  const { navigate } = useRouter()

  return (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || isModifiedClick(event)) {
          return
        }
        const url = new URL(href, window.location.href)
        if (url.origin !== window.location.origin) {
          return
        }
        event.preventDefault()
        navigate(`${url.pathname}${url.search}${url.hash}`)
      }}
    >
      {children}
    </a>
  )
}

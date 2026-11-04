import type { ReactNode } from "react"
import { ArrowUpRight } from "lucide-react"

export function ExternalLink({
  href,
  children,
  className = "inline-link",
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
      <ArrowUpRight size={14} aria-hidden="true" />
    </a>
  )
}

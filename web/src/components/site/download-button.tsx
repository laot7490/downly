import { Download } from "lucide-react"
import { useSetupDownloadUrl } from "@/hooks/use-setup-download-url"

export function DownloadButton({ label }: { label: string }) {
  const href = useSetupDownloadUrl()

  return (
    <a href={href} className="download-button">
      <Download size={16} aria-hidden="true" />
      {label}
    </a>
  )
}

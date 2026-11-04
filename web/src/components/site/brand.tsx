const brandIcon = "/brand/icon-128.png"

export function Brand({ className = "brand-lockup" }: { className?: string }) {
  return (
    <span className={className}>
      <img
        className="brand-mark"
        src={brandIcon}
        alt=""
        width={22}
        height={22}
        decoding="async"
      />
      <span className="brand-name">Downly</span>
    </span>
  )
}

export function BrandMark({
  className = "brand-mark",
}: {
  className?: string
}) {
  return (
    <img
      className={className}
      src={brandIcon}
      alt=""
      width={28}
      height={28}
      decoding="async"
    />
  )
}

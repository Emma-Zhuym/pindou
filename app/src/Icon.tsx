// Line icons drawn with the shared stroke style (see .icon in App.css).
export function Icon({ d, size = 24 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="icon">
      <path d={d} />
    </svg>
  )
}

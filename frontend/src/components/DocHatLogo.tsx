// DocHat brand mark: same tile family as TaskHat, with a white document.
export default function DocHatLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="DocHat">
      <rect width="24" height="24" rx="5" fill="#1868DB" />
      <rect x="6.5" y="4.8" width="11" height="14.4" rx="1.5" fill="#fff" />
      <rect x="8.6" y="8" width="6.8" height="1.6" rx="0.8" fill="#1868DB" />
      <rect x="8.6" y="11.2" width="6.8" height="1.6" rx="0.8" fill="#9DC1F7" />
      <rect x="8.6" y="14.4" width="4.4" height="1.6" rx="0.8" fill="#9DC1F7" />
    </svg>
  )
}

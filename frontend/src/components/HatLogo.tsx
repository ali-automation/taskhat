// TaskHat brand mark: rounded blue tile with a white top hat.
export default function HatLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="TaskHat">
      <rect width="24" height="24" rx="5" fill="#1868DB" />
      <path
        d="M8.4 6.5h7.2c.4 0 .7.3.7.7v6h1.9c.5 0 .9.4.9.9s-.4.9-.9.9H5.8c-.5 0-.9-.4-.9-.9s.4-.9.9-.9h1.9v-6c0-.4.3-.7.7-.7z"
        fill="#fff"
      />
      <rect x="7.7" y="10.2" width="8.6" height="1.6" fill="#9DC1F7" />
    </svg>
  )
}

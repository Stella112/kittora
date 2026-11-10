// Kittora mark: rounded emerald K with the gold "sun" dot (from the brand logo), and the lowercase wordmark.
export function LogoMark({ size = 32, className = '' }: { size?: number, className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <g fill="none" stroke="#0e6b52" strokeLinecap="round" strokeWidth="9.5">
        <path d="M19 12v40" />
        <path d="M43 13 25.5 30.5" />
        <path d="M27 33 44 51" />
      </g>
      <circle cx="47" cy="27" r="6.5" fill="#f2b134" />
      <circle cx="47" cy="27" r="2.6" fill="#f6b9cf" />
    </svg>
  )
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="grid h-9 w-9 place-items-center rounded-full bg-white shadow-[0_1px_4px_rgba(16,35,29,0.12)] ring-1 ring-line"><LogoMark size={24} /></span>
      <span className="text-[22px] font-black lowercase tracking-tight text-brand-strong">kittora</span>
    </span>
  )
}

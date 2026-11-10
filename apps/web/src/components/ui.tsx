import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { hostNetwork } from '../lib/nimiq.ts'
import type { AppError } from '../lib/errors.ts'

export function Button({ variant = 'primary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const base = 'min-h-12 w-full rounded-full px-5 text-base font-extrabold transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed'
  const v = variant === 'primary'
    ? 'bg-brand text-surface shadow-[0_6px_16px_-6px_rgba(14,107,82,0.6)] hover:bg-brand-strong'
    : variant === 'secondary'
      ? 'bg-brand-soft text-brand-strong hover:bg-mint/40'
      : 'bg-transparent text-brand-strong underline-offset-4 hover:underline'
  return <button type="button" className={`${base} ${v} ${className}`} {...p} />
}

export function Card({ children, className = '' }: { children: ReactNode, className?: string }) {
  return <section className={`rounded-[28px] bg-surface p-5 shadow-[0_2px_12px_rgba(16,35,29,0.06)] ring-1 ring-line ${className}`}>{children}</section>
}

/** Deep emerald balance panel with the brand's gold sun and pink dots (fixed colours: reads the same in dark mode). */
export function Hero({ children, className = '' }: { children: ReactNode, className?: string }) {
  return (
    <section className={`relative overflow-hidden rounded-[28px] p-5 text-white shadow-[0_12px_30px_-12px_rgba(10,79,61,0.7)] ${className}`} style={{ background: 'linear-gradient(145deg, #0e6b52 0%, #0a4f3d 70%, #083f31 100%)' }}>
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full border-[10px] border-white/10" />
      <span aria-hidden className="pointer-events-none absolute right-6 top-6 h-10 w-10 rounded-full bg-[#f2b134] shadow-[0_0_0_6px_rgba(242,177,52,0.25)]" />
      <span aria-hidden className="pointer-events-none absolute right-9 top-9 h-4 w-4 rounded-full bg-[#f6b9cf]" />
      <span aria-hidden className="pointer-events-none absolute -bottom-6 left-1/3 h-16 w-16 rounded-full bg-[#f6b9cf]/15" />
      <div className="relative">{children}</div>
    </section>
  )
}

export function TestnetBadge() {
  if (hostNetwork() !== 'testnet') return null
  return <span className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-bold tracking-wide text-warn" aria-label="Test network">TESTNET</span>
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

export function ErrorPanel({ error, onRetry, compact = false }: { error: AppError, onRetry?: () => void, compact?: boolean }) {
  const tone = error.kind === 'pending' ? 'bg-warn-soft text-warn' : error.kind === 'rejected' ? 'bg-brand-soft text-ink' : 'bg-bad-soft text-bad'
  return (
    <div role="alert" className={`rounded-2xl p-4 ${tone}`}>
      <p className="font-semibold">{error.title}</p>
      <p className="mt-1 text-sm text-ink">{error.message}</p>
      {onRetry && <div className={compact ? 'mt-3' : 'mt-4'}><Button variant="secondary" onClick={onRetry}>{error.retryLabel}</Button></div>}
    </div>
  )
}

export function usdt(amount: bigint | undefined, opts: { sign?: boolean } = {}) {
  if (amount === undefined) return '—'
  const neg = amount < 0n
  const v = neg ? -amount : amount
  const whole = v / 1_000_000n
  const cents = (v % 1_000_000n) / 10_000n
  const s = `${whole.toLocaleString('en-US')}.${cents.toString().padStart(2, '0')}`
  return `${neg ? '−' : opts.sign ? '+' : ''}${s}`
}

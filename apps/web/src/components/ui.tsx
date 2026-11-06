import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { hostNetwork } from '../lib/nimiq.ts'
import type { AppError } from '../lib/errors.ts'

export function Button({ variant = 'primary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const base = 'min-h-12 w-full rounded-2xl px-5 text-base font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const v = variant === 'primary'
    ? 'bg-brand text-white hover:bg-brand-strong'
    : variant === 'secondary'
      ? 'bg-brand-soft text-brand-strong hover:bg-line'
      : 'bg-transparent text-brand-strong underline-offset-4 hover:underline'
  return <button type="button" className={`${base} ${v} ${className}`} {...p} />
}

export function Card({ children, className = '' }: { children: ReactNode, className?: string }) {
  return <section className={`rounded-3xl bg-surface p-5 shadow-[0_1px_3px_rgba(43,29,20,0.08)] ${className}`}>{children}</section>
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

// "Add money" bottom sheet (pocket choices as cards) and a clearly-labelled "what if" projection.
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { projectWeekly } from '../../lib/savingsMath.ts'
import { Card, usdt } from '../../components/ui.tsx'
import type { PocketView } from '../../lib/portfolio.ts'
import { pocketName } from './Save.tsx'

const OPTIONS = [
  { to: '/save/new/flex', title: 'Flex', sub: 'Save and take out any time', tag: 'Most flexible', dot: 'bg-mint text-brand-strong', icon: 'M12 5v14M5 12h14' },
  { to: '/save/new/target', title: 'Target', sub: 'Name a goal and watch it fill', tag: 'Goals', dot: 'bg-gold text-[#3b2a06]', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { to: '/save/new/safelock', title: 'SafeLock', sub: 'Locked by the contract until your date', tag: 'No early exit', dot: 'bg-pink text-[#5a1830]', icon: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z' },
  { to: '/save/nim', title: 'NIM SafeLock', sub: 'Keep NIM staked and back it with a USDT bond', tag: 'Nimiq', dot: 'bg-brand-soft text-brand-strong', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z' },
] as const

export function AddMoneySheet({ open, onClose }: { open: boolean, onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Add money">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-[#0b1512]/45" onClick={onClose} />
      <div className="relative w-full max-w-[480px] rounded-t-[32px] bg-surface px-4 pb-[max(env(safe-area-inset-bottom),20px)] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line" aria-hidden />
        <h2 className="text-xl font-black">Add money to</h2>
        <ul className="mt-3 space-y-2">
          {OPTIONS.map(o => (
            <li key={o.to}>
              <Link to={o.to} onClick={onClose} className="flex items-center gap-3 rounded-[22px] p-3 ring-1 ring-line transition active:scale-[0.99]">
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${o.dot}`} aria-hidden>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={o.icon} /></svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-extrabold text-ink">{o.title}</span>
                  <span className="block text-sm text-muted">{o.sub}</span>
                </span>
                <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-[11px] font-bold text-muted">{o.tag}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const WEEKLY = [2, 5, 10, 25]
const YEARS = [1, 3, 5]

export function ProjectionCard({ apr }: { apr: number | null }) {
  const [perWeek, setPerWeek] = useState(5)
  const [years, setYears] = useState(1)
  const rate = apr ?? 0
  const p = projectWeekly(perWeek, years, rate)
  const chip = (on: boolean) => `min-h-10 flex-1 rounded-full text-sm font-extrabold ${on ? 'bg-brand text-surface' : 'bg-brand-soft text-brand-strong'}`
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-black">What if you saved every week?</h2>
      <div className="flex gap-2" role="group" aria-label="Amount per week">
        {WEEKLY.map(w => <button key={w} type="button" aria-pressed={perWeek === w} onClick={() => setPerWeek(w)} className={chip(perWeek === w)}>{w} USDT</button>)}
      </div>
      <div className="flex gap-2" role="group" aria-label="For how long">
        {YEARS.map(y => <button key={y} type="button" aria-pressed={years === y} onClick={() => setYears(y)} className={chip(years === y)}>{y} year{y === 1 ? '' : 's'}</button>)}
      </div>
      <div className="rounded-[22px] bg-gold-soft p-4">
        <p className="text-sm font-bold text-muted">You could have</p>
        <p className="tabular text-[34px] font-black leading-tight text-ink">{p.value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} <span className="text-base">USDT</span></p>
        <p className="tabular text-sm text-muted">{p.putIn.toLocaleString('en-US')} put in + <b className="text-good">{p.interest.toFixed(2)} interest</b></p>
      </div>
      <p className="text-xs text-muted">Simulated at today's {(rate * 100).toFixed(2)}% variable Aave rate, compounding weekly. The rate changes all the time; this is not a promise.</p>
    </Card>
  )
}

/** "Withdraw" bottom sheet: pick the pocket to take money out of. */
export function WithdrawSheet({ open, onClose, pockets }: { open: boolean, onClose: () => void, pockets: PocketView[] }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  const now = BigInt(Math.floor(Date.now() / 1000))
  const withMoney = pockets.filter(p => p.assets > 0n)
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Withdraw">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-[#0b1512]/45" onClick={onClose} />
      <div className="relative w-full max-w-[480px] rounded-t-[32px] bg-surface px-4 pb-[max(env(safe-area-inset-bottom),20px)] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line" aria-hidden />
        <h2 className="text-xl font-black">Withdraw from</h2>
        <p className="text-sm text-muted">Money goes back to your Nimiq Pay wallet on Polygon.</p>
        {withMoney.length === 0 && <p className="mt-4 rounded-[22px] bg-canvas p-4 text-sm text-muted">No pocket has money in it yet.</p>}
        <ul className="mt-3 space-y-2">
          {withMoney.map(p => {
            const locked = p.kind === 2 && p.unlockAt > now
            return (
              <li key={String(p.id)}>
                <Link to={`/save/pocket/${p.id}#withdraw`} onClick={onClose} className="flex items-center justify-between gap-3 rounded-[22px] p-3 ring-1 ring-line transition active:scale-[0.99]">
                  <span className="min-w-0">
                    <span className="block font-extrabold text-ink">{pocketName(p.id, p.kind)}</span>
                    <span className="block text-sm text-muted">{locked ? `Locked until ${new Date(Number(p.unlockAt) * 1000).toLocaleDateString()}` : 'Available now'}</span>
                  </span>
                  <span className="tabular shrink-0 font-black">{usdt(p.assets)} <span className="text-xs font-bold text-muted">USDT</span></span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

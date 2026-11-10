// Savings hero (inspired by the Aave app, in Kittora's colours): earning pill, big balance with small cents, a live
// "earned" ticker, and 7-day growth bars. Earnings are exact on-chain at load (balance − deposits); the ticker adds an
// estimate at today's variable rate between refreshes, and says so.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { aaveSupplyRateRay } from '../lib/chainActions.ts'
import { relayer } from '../lib/relayer.ts'
import { aprFraction, growthBars, splitUsdt, tickEarned, tickerDecimals, type Flow } from '../lib/savingsMath.ts'
import type { Portfolio } from '../lib/portfolio.ts'
import { Hero } from './ui.tsx'

export function useApr() {
  const q = useQuery({ queryKey: ['aaveRate'], queryFn: aaveSupplyRateRay, refetchInterval: 60_000 })
  return q.data !== undefined ? aprFraction(q.data) : null
}

function useTicker(p: Portfolio | undefined, apr: number | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const t = setInterval(() => setNow(Date.now()), reduce ? 1000 : 120)
    return () => clearInterval(t)
  }, [])
  if (!p) return null
  return tickEarned(p.earned, p.vaultTotal, apr ?? 0, (now - p.loadedAt) / 1000)
}

export function SavingsHero({ evm, p, title = 'All your savings', total }: { evm: Address | null, p: Portfolio | undefined, title?: string, total?: bigint }) {
  const apr = useApr()
  const earned = useTicker(p, apr)
  const act = useQuery({ queryKey: ['activity', evm], queryFn: () => relayer.activity(evm!), enabled: Boolean(evm), refetchInterval: 60_000 })
  const balance = total ?? (p ? p.vaultTotal : 0n)
  const { whole, cents } = splitUsdt(balance)
  const decimals = tickerDecimals(p?.vaultTotal ?? 0n, apr ?? 0)

  const flows: Flow[] = (act.data?.items ?? [])
    .filter(i => i.contract === 'vault' && i.ts && (i.event === 'Deposited' || i.event === 'Withdrawn'))
    .map(i => ({ ts: i.ts!, delta: (i.event === 'Deposited' ? 1n : -1n) * BigInt(String(i.args.amount ?? 0)) }))
  const bars = growthBars(flows, p?.vaultTotal ?? 0n, Math.floor(Date.now() / 1000), 7)
  const max = bars.reduce((m, b) => (b.value > m ? b.value : m), 0n)
  const hasData = max > 0n

  return (
    <Hero>
      <p className="inline-flex items-center gap-1.5 rounded-full bg-[#f2b134] px-3 py-1 text-xs font-black text-[#3b2a06]">
        <span aria-hidden className="h-2 w-2 rounded-full bg-[#f6b9cf]" />
        {apr !== null ? `Earning ${(apr * 100).toFixed(2)}% APR` : 'Earning the Aave rate'}
      </p>
      <p className="mt-3 text-sm font-bold text-white/75">{title}</p>
      <p className="tabular font-black leading-none">
        <span className="text-[46px]">{whole}</span><span className="text-[26px] text-white/80">{cents}</span>
        <span className="ml-1.5 text-base font-bold text-white/70">USDT</span>
      </p>
      <p className="tabular mt-2 flex items-center gap-1.5 text-sm font-bold">
        <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-[#7ee0b5]" />
        <span className="text-[#9ff0c9]">{earned !== null ? earned.toFixed(decimals) : (0).toFixed(decimals)} USDT earned</span>
        <span className="text-white/60">so far</span>
      </p>

      <div className="mt-4" aria-label="Your savings over the last 7 days" role="img">
        <div className="flex h-24 items-end gap-1.5">
          {bars.map((b, i) => {
            const h = hasData ? Math.max(6, Math.round(Number((b.value * 100n) / (max || 1n)))) : 8 + i * 4
            const today = i === bars.length - 1
            return (
              <div key={b.day} className="flex h-full flex-1 flex-col items-center justify-end">
                <div className={`w-full rounded-t-xl rounded-b-md ${today ? 'bg-[#f2b134]' : 'bg-white/25'}`} style={{ height: `${h}%` }} />
              </div>
            )
          })}
        </div>
        <div className="mt-1 flex gap-1.5">
          {bars.map(b => (
            <div key={b.day} className="flex flex-1 justify-center">
              {b.mark && <span className={`grid h-4 w-4 place-items-center rounded-full text-[10px] font-black ${b.mark === 'out' ? 'bg-[#f6b9cf] text-[#5a1830]' : 'bg-[#9ff0c9] text-[#0a4f3d]'}`}>{b.mark === 'out' ? '−' : '+'}</span>}
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] font-bold text-white/60"><span>{bars[0].label}</span><span>Today</span></div>
      </div>
      <p className="mt-2 text-[11px] text-white/55">Earned is read on-chain; the live count is an estimate at today's variable rate.</p>
    </Hero>
  )
}

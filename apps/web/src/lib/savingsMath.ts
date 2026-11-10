// Pure maths behind the savings hero, ticker, growth chart and projection (unit-tested; no browser imports).
const YEAR = 365 * 24 * 3600

/** Aave ray (1e27) APR → fraction, e.g. 0.034. */
export const aprFraction = (ray: bigint) => Number((ray * 1_000_000n) / 10n ** 27n) / 1_000_000

/** micro-USDT → { whole: "9,352", cents: ".16" } for a big number with small cents. */
export function splitUsdt(micro: bigint) {
  const v = micro < 0n ? 0n : micro
  const whole = (v / 1_000_000n).toLocaleString('en-US')
  const cents = ((v % 1_000_000n) / 10_000n).toString().padStart(2, '0')
  return { whole, cents: `.${cents}` }
}

/**
 * Earned so far, ticking: the exact on-chain earnings at load (balance − deposits) plus an estimate of what the
 * balance earns per second at the current variable rate since then. Returned in USDT (float, for display only).
 */
export function tickEarned(earnedMicro: bigint, balanceMicro: bigint, apr: number, secondsSinceLoad: number) {
  return Number(earnedMicro) / 1e6 + (Number(balanceMicro) / 1e6) * apr * (Math.max(0, secondsSinceLoad) / YEAR)
}

export interface Flow { ts: number, delta: bigint } // + deposit, − withdrawal (micro-USDT)
export interface Bar { day: number, value: bigint, mark: 'in' | 'out' | 'both' | null, label: string }

/**
 * Daily bars for the last `days` days: what you had put in by the end of each day (from your deposits and
 * withdrawals), and today's bar is today's real balance (deposits + interest). Marks show days with money in / out.
 */
export function growthBars(flows: Flow[], balanceNow: bigint, nowTs: number, days = 7): Bar[] {
  const dayOf = (ts: number) => Math.floor(ts / 86400)
  const today = dayOf(nowTs)
  const sorted = [...flows].sort((a, b) => a.ts - b.ts)
  const bars: Bar[] = []
  for (let d = today - days + 1; d <= today; d++) {
    let total = 0n
    let inn = false
    let out = false
    for (const f of sorted) {
      if (dayOf(f.ts) <= d) total += f.delta
      if (dayOf(f.ts) === d) { if (f.delta > 0n) inn = true; else if (f.delta < 0n) out = true }
    }
    const value = d === today ? balanceNow : total < 0n ? 0n : total
    const date = new Date(d * 86400 * 1000)
    bars.push({ day: d, value, mark: inn && out ? 'both' : inn ? 'in' : out ? 'out' : null, label: d === today ? 'Today' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) })
  }
  return bars
}

/** Future value of saving `perWeek` USDT every week for `years` at a fixed `apr` (weekly compounding), plus total put in. */
export function projectWeekly(perWeek: number, years: number, apr: number, startBalance = 0) {
  const weeks = Math.round(years * 52)
  const r = apr / 52
  let v = startBalance
  for (let i = 0; i < weeks; i++) v = v * (1 + r) + perWeek
  const putIn = startBalance + perWeek * weeks
  return { value: v, putIn, interest: v - putIn }
}

/** Decimals so the ticker's last digit moves about once a second (2..9), like the Aave app's live counter. */
export function tickerDecimals(balanceMicro: bigint, apr: number) {
  const perSec = (Number(balanceMicro) / 1e6) * apr / YEAR
  if (!(perSec > 0)) return 6
  return Math.min(9, Math.max(2, Math.ceil(-Math.log10(perSec))))
}

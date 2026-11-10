import { describe, it, expect } from 'vitest'
import { aprFraction, growthBars, projectWeekly, splitUsdt, tickEarned, tickerDecimals } from './savingsMath.ts'

describe('savings maths', () => {
  it('splits a balance into whole and cents', () => {
    expect(splitUsdt(9_352_160_000n)).toEqual({ whole: '9,352', cents: '.16' })
    expect(splitUsdt(0n)).toEqual({ whole: '0', cents: '.00' })
  })

  it('reads the Aave ray rate', () => {
    expect(aprFraction(34n * 10n ** 24n)).toBeCloseTo(0.034, 6) // 3.4%
  })

  it('ticker = exact earnings at load + estimate at the current rate since', () => {
    expect(tickEarned(12_000n, 100_000_000n, 0.0365, 0)).toBeCloseTo(0.012, 9)
    // 100 USDT at 3.65% for one day ≈ 0.01 USDT
    expect(tickEarned(0n, 100_000_000n, 0.0365, 86400)).toBeCloseTo(0.01, 6)
  })

  it('growth bars: deposits and withdrawals by day, today = real balance, marks', () => {
    const day = 86400
    const now = 20_000 * day + 3600
    const bars = growthBars([
      { ts: now - 5 * day, delta: 5_000_000n },
      { ts: now - 2 * day, delta: 3_000_000n },
      { ts: now - 2 * day + 60, delta: -1_000_000n },
    ], 7_010_000n, now, 7)
    expect(bars.map(b => b.value)).toEqual([0n, 5_000_000n, 5_000_000n, 5_000_000n, 7_000_000n, 7_000_000n, 7_010_000n])
    expect(bars.map(b => b.mark)).toEqual([null, 'in', null, null, 'both', null, null])
    expect(bars[6].label).toBe('Today')
  })

  it('projection: weekly saving with interest beats putting it under the mattress', () => {
    const p = projectWeekly(5, 1, 0.04)
    expect(p.putIn).toBe(260)
    expect(p.value).toBeGreaterThan(260)
    expect(p.interest).toBeCloseTo(p.value - 260, 9)
    expect(projectWeekly(5, 1, 0).value).toBe(260)
  })

  it('ticker decimals: small balances show more digits so the count visibly moves', () => {
    expect(tickerDecimals(20_000_000n, 0.0357)).toBe(8) // 20 USDT earns ~2e-8 per second
    expect(tickerDecimals(9_352_000_000n, 0.0725)).toBe(5)
    expect(tickerDecimals(0n, 0.04)).toBe(6)
  })
})

import { describe, it, expect } from 'vitest'
import { parseUsdt, parseNimToLuna, formatNim, rayToPct } from './amounts.ts'

describe('amounts', () => {
  it('parses USDT to 6 decimals and rejects junk', () => {
    expect(parseUsdt('12.5')).toBe(12_500_000n)
    expect(parseUsdt('0,01')).toBe(10_000n)
    expect(parseUsdt('1.1234567')).toBeNull()
    expect(parseUsdt('0')).toBeNull()
    expect(parseUsdt('-1')).toBeNull()
    expect(parseUsdt('abc')).toBeNull()
  })
  it('parses NIM to Luna (1 NIM = 100,000 Luna)', () => {
    expect(parseNimToLuna('1')).toBe(100_000n)
    expect(parseNimToLuna('2.5')).toBe(250_000n)
    expect(parseNimToLuna('1.000001')).toBeNull()
    expect(formatNim(250_000n)).toBe('2.5')
  })
  it('converts Aave ray rate to percent', () => {
    expect(rayToPct(35710349581199828576057360n)).toBe('3.57%')
  })
})

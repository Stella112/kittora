// USDT has 6 decimals on Polygon; NIM is counted in Luna (1 NIM = 100,000 Luna, SDK docs).
export function parseUsdt(input: string): bigint | null {
  const s = input.trim().replace(',', '.')
  if (!/^\d+(\.\d{0,6})?$/.test(s)) return null
  const [w, f = ''] = s.split('.')
  const v = BigInt(w) * 1_000_000n + BigInt((f + '000000').slice(0, 6))
  return v > 0n ? v : null
}

export function parseNimToLuna(input: string): bigint | null {
  const s = input.trim().replace(',', '.')
  if (!/^\d+(\.\d{0,5})?$/.test(s)) return null
  const [w, f = ''] = s.split('.')
  const v = BigInt(w) * 100_000n + BigInt((f + '00000').slice(0, 5))
  return v > 0n ? v : null
}

export function formatNim(luna: bigint | number): string {
  const v = BigInt(luna)
  const whole = v / 100_000n
  const frac = (v % 100_000n).toString().padStart(5, '0').replace(/0+$/, '')
  return frac ? `${whole.toLocaleString('en-US')}.${frac}` : whole.toLocaleString('en-US')
}

/** Aave ray (1e27) APR → percentage string with 2 decimals. */
export function rayToPct(ray: bigint): string {
  const bp = (ray * 10_000n) / 10n ** 27n // basis points
  return `${(Number(bp) / 100).toFixed(2)}%`
}

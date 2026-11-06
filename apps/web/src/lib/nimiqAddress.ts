/** Nimiq user-friendly address → 20-byte hex. Base32 alphabet per Nimiq address format (NQ + 2 check digits + 32 chars). */
const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
export function nimiqToHex(addr: string): `0x${string}` {
  const s = addr.replace(/\s/g, '').toUpperCase().slice(4)
  let bits = ''
  for (const c of s) {
    const i = ALPHABET.indexOf(c)
    if (i < 0) throw new Error('bad Nimiq address')
    bits += i.toString(2).padStart(5, '0')
  }
  let hex = ''
  for (let i = 0; i < 160; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return `0x${hex}`
}

// Nimiq memo stamp for a group event (main brief §4.1 item 3, Addendum A1).
// Nimiq Pay's host rejects messages over 64 UTF-8 bytes (useMiniAppHost.ts sendBasicTransactionWithData @dd90a9c5),
// so the 32-byte Polygon tx hash is base64url-encoded: "KTR1:<code>:<groupId>:<43 chars>" ≤ 64 bytes.

export const STAMP_PREFIX = 'KTR1'
export const STAMP_MAX_BYTES = 64

/** Event code per relayed action (2 letters keeps the memo short and readable). */
export const STAMP_CODES: Record<string, string> = {
  'group.createGroup': 'cg',
  'group.join': 'jn',
  'group.buyShares': 'ct',
  'group.requestLoan': 'rq',
  'group.approveLoan': 'la',
  'group.cancelLoan': 'cl',
  'group.disburse': 'ds',
  'group.repay': 'rp',
  'group.markDefault': 'df',
  'group.proposeSocialPayout': 'pp',
  'group.approveSocialPayout': 'pa',
  'group.executeSocialPayout': 'px',
  'group.claimShareOut': 'so',
  'group.updateProfile': 'pf',
  'group.setTreasurer': 'rl',
  'group.transferAdmin': 'ad',
  'group.removeMember': 'rm',
  // Autosave run into a group: sent by the relayer, stamped later by the member from the app
  'mandate.run': 'ar',
}
const CODES = new Set(Object.values(STAMP_CODES))

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function hexToB64url(hex: string): string {
  const h = hex.replace(/^0x/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error('expected a 32-byte tx hash')
  const bytes = h.match(/../g)!.map(x => parseInt(x, 16))
  let bits = ''
  for (const b of bytes) bits += b.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 6) out += B64[parseInt(bits.slice(i, i + 6).padEnd(6, '0'), 2)]
  return out // 43 chars, no padding
}

function b64urlToHex(s: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(s)) throw new Error('bad hash encoding')
  let bits = ''
  for (const c of s) bits += B64.indexOf(c).toString(2).padStart(6, '0')
  let hex = ''
  for (let i = 0; i < 256; i += 8) hex += parseInt(bits.slice(i, i + 8), 2).toString(16).padStart(2, '0')
  return `0x${hex}`
}

export function encodeStamp(action: string, groupId: bigint | number | string, polygonTx: string): string {
  const code = STAMP_CODES[action]
  if (!code) throw new Error(`no stamp code for ${action}`)
  const memo = `${STAMP_PREFIX}:${code}:${BigInt(groupId)}:${hexToB64url(polygonTx)}`
  if (new TextEncoder().encode(memo).length > STAMP_MAX_BYTES) throw new Error('stamp too long')
  return memo
}

export function decodeStamp(memo: string): { code: string, groupId: bigint, polygonTx: `0x${string}` } | null {
  const m = memo.match(/^KTR1:([a-z]{2}):(\d{1,12}):([A-Za-z0-9_-]{43})$/)
  if (!m || !CODES.has(m[1])) return null
  return { code: m[1], groupId: BigInt(m[2]), polygonTx: b64urlToHex(m[3]) as `0x${string}` }
}

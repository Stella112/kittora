// Stamp encoding + verification. TEST MOCKS: a fake Nimiq RPC and a fake Polygon receipt reader (labelled below).
import { describe, it, expect } from 'vitest'
import { encodeStamp, decodeStamp, STAMP_CODES, STAMP_MAX_BYTES } from '@kittora/core'
import { verifyStamp, hexToUtf8, stampsFor } from '../src/stamps.ts'
import { openDb } from '../src/db.ts'
import type { NimiqRpc } from '../src/nimiq.ts'

const GK = '0x2271dA8756185B48A46A17051fF3A90d6481ed5f'
const VAULT = '0x7B1e1bAed045Db95b5F5b3E1e6E50efdac851251'
const P1 = `0x${'ab'.repeat(32)}`
const P2 = `0x${'cd'.repeat(32)}`
const N1 = 'ef'.repeat(32)
const utf8hex = (s: string) => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('')

describe('stamp memo', () => {
  it('round-trips every action and stays within 64 bytes even for a 12-digit group id', () => {
    for (const action of Object.keys(STAMP_CODES)) {
      const memo = encodeStamp(action, 999_999_999_999n, P1)
      expect(new TextEncoder().encode(memo).length).toBeLessThanOrEqual(STAMP_MAX_BYTES)
      const d = decodeStamp(memo)!
      expect(d.polygonTx).toBe(P1)
      expect(d.groupId).toBe(999_999_999_999n)
      expect(d.code).toBe(STAMP_CODES[action])
    }
    expect(encodeStamp('group.repay', 12n, P1)).toMatch(/^KTR1:rp:12:[A-Za-z0-9_-]{43}$/)
  })
  it('rejects junk and unknown codes', () => {
    expect(decodeStamp('hello')).toBeNull()
    expect(decodeStamp(`KTR1:zz:1:${'A'.repeat(43)}`)).toBeNull()
    expect(() => encodeStamp('vault.deposit', 1n, P1)).toThrow()
    expect(() => encodeStamp('group.repay', 1n, '0x1234')).toThrow()
  })
})

/** TEST MOCK Nimiq RPC */
function fakeNimiq(txs: Record<string, { confirmations: number, executionResult: boolean, recipientData: string } | null>): NimiqRpc {
  return { transaction: async (h: string) => (txs[h] ? { hash: h, from: '', to: '', value: 1, ...txs[h]! } : null) } as unknown as NimiqRpc
}
/** TEST MOCK Polygon receipts */
function fakePub(rcpts: Record<string, { status: 'success' | 'reverted', from: string } | undefined>) {
  return { getTransactionReceipt: async ({ hash }: { hash: string }) => {
    const r = rcpts[hash]
    if (!r) throw new Error('not found')
    return { status: r.status, logs: [{ address: r.from }] }
  } } as never
}

describe('verifyStamp', () => {
  const memo = (p: string) => utf8hex(encodeStamp('group.repay', 3n, p))
  const deps = (nimiq: NimiqRpc, pub: never) => ({ nimiq, pub, db: openDb(':memory:').db, addresses: { vault: VAULT as `0x${string}`, group: GK as `0x${string}` } })

  it('stamps a real Kittora tx, then returns the first stamp on repeat', async () => {
    const d = deps(fakeNimiq({ [N1]: { confirmations: 3, executionResult: true, recipientData: memo(P1) } }), fakePub({ [P1]: { status: 'success', from: GK } }))
    expect(await verifyStamp({ polygonTx: P1, nimiqTx: N1 }, d)).toMatchObject({ status: 'stamped', nimiqTx: N1, code: 'rp', groupId: 3 })
    expect(await verifyStamp({ polygonTx: P1, nimiqTx: 'aa'.repeat(32) }, d)).toMatchObject({ status: 'stamped', nimiqTx: N1 })
    expect((await stampsFor(d.db, [P1.toUpperCase().replace('0X', '0x'), P2])).get(P1)).toBe(N1)
  })

  it('pending while the Nimiq tx is unknown or not in a block', async () => {
    expect((await verifyStamp({ polygonTx: P1, nimiqTx: N1 }, deps(fakeNimiq({}), fakePub({})))).status).toBe('pending')
    const d = deps(fakeNimiq({ [N1]: { confirmations: 0, executionResult: true, recipientData: memo(P1) } }), fakePub({ [P1]: { status: 'success', from: GK } }))
    expect((await verifyStamp({ polygonTx: P1, nimiqTx: N1 }, d)).status).toBe('pending')
  })

  it('rejects a failed Nimiq tx, a memo for another tx, junk data, a failed or foreign Polygon tx', async () => {
    const ok = { confirmations: 1, executionResult: true }
    const run = (n: object, p: object, polygonTx = P1) => verifyStamp({ polygonTx, nimiqTx: N1 }, deps(fakeNimiq({ [N1]: n as never }), fakePub(p as never)))
    expect((await run({ ...ok, executionResult: false, recipientData: memo(P1) }, { [P1]: { status: 'success', from: GK } })).status).toBe('rejected')
    expect((await run({ ...ok, recipientData: memo(P2) }, { [P1]: { status: 'success', from: GK } })).status).toBe('rejected')
    expect((await run({ ...ok, recipientData: utf8hex('hi') }, { [P1]: { status: 'success', from: GK } })).status).toBe('rejected')
    expect((await run({ ...ok, recipientData: memo(P1) }, { [P1]: { status: 'reverted', from: GK } })).status).toBe('rejected')
    expect((await run({ ...ok, recipientData: memo(P1) }, { [P1]: { status: 'success', from: '0x000000000000000000000000000000000000dEaD' } })).status).toBe('rejected')
    expect((await verifyStamp({ polygonTx: 'nope', nimiqTx: N1 }, deps(fakeNimiq({}), fakePub({})))).status).toBe('rejected')
  })

  it('decodes hex message data', () => {
    expect(hexToUtf8(utf8hex('KTR1'))).toBe('KTR1')
    expect(hexToUtf8('zz')).toBe('')
  })
})

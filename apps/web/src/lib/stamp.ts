// Nimiq memo stamp after a confirmed group action (main brief §4.1 item 3, Addendum A1).
// The user sends 1 Luna to their own Nimiq address with the memo KTR1:<code>:<group>:<polygon tx>; the relayer then
// verifies it (Nimiq tx in a block, memo names this Polygon tx, Polygon tx is a successful Kittora tx). Optional: if the
// user declines, the group action itself is still confirmed.
import { decodeEventLog, type Abi, type Hex } from 'viem'
import { encodeStamp, GroupKittyAbi, STAMP_CODES } from '@kittora/core'
import { nimiqProvider, unwrap } from './nimiq.ts'
import { reader } from './evm.ts'
import { relayer } from './relayer.ts'
import { store } from './storage.ts'

/** Polygon tx hash → relayed group action, filled by chainActions when a group action is relayed. */
export const groupRelays = new Map<string, string>()

export const isStampable = (action: string | undefined) => Boolean(action && STAMP_CODES[action])

async function groupIdFromReceipt(hash: Hex): Promise<bigint | null> {
  const rc = await reader().getTransactionReceipt({ hash })
  for (const l of rc.logs) {
    try {
      const ev = decodeEventLog({ abi: GroupKittyAbi as Abi, data: l.data, topics: l.topics }) as unknown as { eventName: string, args: { groupId?: bigint } }
      if (ev.args?.groupId !== undefined) return ev.args.groupId
    } catch { /* not a GroupKitty event */ }
  }
  return null
}

/** Sends the stamp and waits until the relayer has verified it. Returns the Nimiq tx hash. */
export async function stampGroupAction(action: string, polygonTx: Hex, groupId: bigint | null): Promise<string> {
  const g = groupId ?? await groupIdFromReceipt(polygonTx)
  if (g === null) throw new Error('could not find the group for this transaction')
  const p = await nimiqProvider()
  const me = store.get<{ nimiqAddress: string }>('session')?.nimiqAddress ?? unwrap(await p.listAccounts())[0]
  const nimiqTx = unwrap(await p.sendBasicTransactionWithData({ recipient: me, value: 1, data: encodeStamp(action, g, polygonTx) }))
  const start = Date.now()
  while (Date.now() - start < 3 * 60_000) {
    const r = await relayer.stamp(polygonTx, nimiqTx).catch((e: { error?: string }) => (e?.error === 'bad_stamp' ? Promise.reject(e) : null))
    if (r?.status === 'stamped') return r.nimiqTx
    await new Promise(res => setTimeout(res, 4000))
  }
  throw Object.assign(new Error('stamp sent, not verified yet'), { error: 'pending', hash: nimiqTx })
}

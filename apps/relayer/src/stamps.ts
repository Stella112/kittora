// Verifies a Nimiq memo stamp for a Kittora group event before it is shown as "Stamped on Nimiq".
// A stamp is accepted only if: the Nimiq tx exists, executed successfully and is in a block; its message decodes to
// KTR1:<code>:<group>:<hash> naming exactly this Polygon tx; and that Polygon tx succeeded and emitted a log from
// GroupKitty (or PocketVault, for group Autosave runs). Nimiq Pay pays from the user's HTLC, so the sender address
// is not used as proof; the memo binding to a real Kittora tx is.
import type { Address, Hex, PublicClient } from 'viem'
import { decodeStamp } from '@kittora/core'
import { stamps, eq, inArray, type Db } from './db.ts'
import type { NimiqRpc } from './nimiq.ts'

export type StampResult =
  | { status: 'stamped', nimiqTx: string, code: string, groupId: number }
  | { status: 'pending', message: string }
  | { status: 'rejected', message: string }

export function hexToUtf8(hex: string): string {
  const h = hex.replace(/^0x/, '')
  if (!/^([0-9a-fA-F]{2})*$/.test(h)) return ''
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(h.match(/../g)?.map(x => parseInt(x, 16)) ?? []))
}

export async function verifyStamp(
  input: { polygonTx: string, nimiqTx: string },
  d: { pub: PublicClient, nimiq: NimiqRpc, db: Db, addresses: { vault: Address, group: Address }, now?: () => number },
): Promise<StampResult> {
  const polygonTx = input.polygonTx.toLowerCase()
  const nimiqTx = input.nimiqTx.toLowerCase().replace(/^0x/, '')
  if (!/^0x[0-9a-f]{64}$/.test(polygonTx) || !/^[0-9a-f]{64}$/.test(nimiqTx)) return { status: 'rejected', message: 'bad hash format' }

  const existing = await d.db.select().from(stamps).where(eq(stamps.polygonTx, polygonTx)).get()
  if (existing) return { status: 'stamped', nimiqTx: existing.nimiqTx, code: existing.code, groupId: existing.groupId }

  const tx = await d.nimiq.transaction(nimiqTx)
  if (!tx) return { status: 'pending', message: 'Nimiq transaction not found yet' }
  if (tx.confirmations < 1) return { status: 'pending', message: 'Nimiq transaction not in a block yet' }
  if (!tx.executionResult) return { status: 'rejected', message: 'Nimiq transaction failed' }
  const memo = decodeStamp(hexToUtf8(tx.recipientData ?? ''))
  if (!memo) return { status: 'rejected', message: 'Nimiq transaction has no Kittora stamp' }
  if (memo.polygonTx.toLowerCase() !== polygonTx) return { status: 'rejected', message: 'stamp names a different Polygon transaction' }

  const rc = await d.pub.getTransactionReceipt({ hash: polygonTx as Hex }).catch(() => null)
  if (!rc) return { status: 'pending', message: 'Polygon transaction not confirmed yet' }
  if (rc.status !== 'success') return { status: 'rejected', message: 'Polygon transaction failed' }
  const ours = new Set([d.addresses.group.toLowerCase(), d.addresses.vault.toLowerCase()])
  if (!rc.logs.some(l => ours.has(l.address.toLowerCase()))) return { status: 'rejected', message: 'not a Kittora transaction' }

  const now = Math.floor((d.now ?? Date.now)() / 1000)
  await d.db.insert(stamps).values({ polygonTx, nimiqTx, code: memo.code, groupId: Number(memo.groupId), createdAt: now }).onConflictDoNothing()
  const row = await d.db.select().from(stamps).where(eq(stamps.polygonTx, polygonTx)).get()
  return { status: 'stamped', nimiqTx: row!.nimiqTx, code: row!.code, groupId: row!.groupId }
}

/** Nimiq stamp hash per Polygon tx hash, for attaching to feed rows. */
export async function stampsFor(db: Db, hashes: string[]): Promise<Map<string, string>> {
  const list = [...new Set(hashes.map(h => h.toLowerCase()))]
  const out = new Map<string, string>()
  for (let i = 0; i < list.length; i += 200) {
    const rows = await db.select().from(stamps).where(inArray(stamps.polygonTx, list.slice(i, i + 200)))
    for (const r of rows) out.set(r.polygonTx, r.nimiqTx)
  }
  return out
}

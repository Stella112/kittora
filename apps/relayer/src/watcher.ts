// NIM SafeLock watcher + attester (Maris item 13: judge by STATE).
// For each active bond inside its forfeit window: if the Nimiq address's active stake < bonded NIM, the attester calls
// forfeitBond(bondId, nimiqTxHash) with the address's most recent transaction as public evidence.
// RPC errors never trigger a forfeit (see NimiqRpc.activeStake).
import type { Abi, Address, Hex, PublicClient } from 'viem'
import type { Logger } from 'pino'
import { PocketVaultAbi } from '@kittora/core'
import { forfeits, eq, type Db } from './db.ts'
import { revertReason, type TxSender } from './chain.ts'
import { bytes20ToNimiq, type NimiqRpc } from './nimiq.ts'

const abi = PocketVaultAbi as Abi

export interface WatcherDeps {
  pub: PublicClient
  attester: TxSender
  db: Db
  log: Logger
  nimiq: NimiqRpc
  vault: Address
  now?: () => number
}

export async function watcherTick(d: WatcherDeps): Promise<{ checked: number, forfeited: number }> {
  let checked = 0
  let forfeited = 0
  const now = BigInt(Math.floor((d.now ?? Date.now)() / 1000))
  const claimDelay = await d.pub.readContract({ address: d.vault, abi, functionName: 'claimDelay' }) as bigint
  const count = await d.pub.readContract({ address: d.vault, abi, functionName: 'bondCount' }) as bigint
  for (let id = 1n; id <= count; id++) {
    const b = await d.pub.readContract({ address: d.vault, abi, functionName: 'bonds', args: [id] }) as readonly [bigint, Address, Hex, bigint, bigint, bigint, Hex, number]
    const [, , nimiqHex, unlockAt, nimLuna, , , status] = b
    if (status !== 1 || now > unlockAt + claimDelay) continue
    const prior = await d.db.select().from(forfeits).where(eq(forfeits.bondId, Number(id))).get()
    if (prior?.status === 'sent' || prior?.status === 'done') continue
    const addr = bytes20ToNimiq(nimiqHex)
    let active: number
    try {
      ({ active } = await d.nimiq.activeStake(addr))
    } catch (e) {
      d.log.warn({ bondId: Number(id), err: String(e) }, 'nimiq rpc error, skipping (no forfeit)')
      continue
    }
    checked++
    if (BigInt(active) >= nimLuna) continue
    const txs = await d.nimiq.latestTxs(addr, 5)
    const evidence = txs[0]?.hash
    if (!evidence) {
      d.log.error({ bondId: Number(id), addr }, 'stake below bond but no transaction found as evidence; not forfeiting')
      continue
    }
    const nimiqTx = `0x${evidence}` as Hex
    d.log.warn({ bondId: Number(id), addr, active, bonded: String(nimLuna), nimiqTx }, 'early unstake detected, forfeiting bond')
    try {
      const hash = await d.attester.send(d.vault, abi, 'forfeitBond', [id, nimiqTx])
      await d.db.insert(forfeits).values({ bondId: Number(id), nimiqTx, txHash: hash, status: 'sent', updatedAt: Number(now) })
        .onConflictDoUpdate({ target: forfeits.bondId, set: { txHash: hash, status: 'sent', updatedAt: Number(now) } })
      forfeited++
    } catch (e) {
      d.log.error({ bondId: Number(id), err: revertReason(e) }, 'forfeit failed')
    }
  }
  return { checked, forfeited }
}

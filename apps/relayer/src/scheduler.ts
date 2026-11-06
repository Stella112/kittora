// Autosave scheduler. Exactly-once per (mandate, run): the idempotency key `${id}:${run}` is written before sending,
// and a run already `sent` is never resent while its tx is pending. The contract independently enforces interval,
// maxRuns, expiry and revoke, so a duplicate can only fail simulation, never double-charge.
import type { Abi, Address, Hex, PublicClient } from 'viem'
import type { Logger } from 'pino'
import { PocketVaultAbi } from '@kittora/core'
import { mandateRuns, eq, type Db } from './db.ts'
import { revertReason, type TxSender } from './chain.ts'
import { usdtAbi } from './actions.ts'

const abi = PocketVaultAbi as Abi

export interface SchedulerDeps {
  pub: PublicClient
  sender: TxSender
  db: Db
  log: Logger
  vault: Address
  usdt: Address
  now?: () => number
}

export async function schedulerTick(d: SchedulerDeps): Promise<{ sent: number, confirmed: number }> {
  let sent = 0
  let confirmed = 0
  const now = BigInt(Math.floor((d.now ?? Date.now)() / 1000))
  const count = await d.pub.readContract({ address: d.vault, abi, functionName: 'mandateCount' }) as bigint
  for (let id = 1n; id <= count; id++) {
    const m = await d.pub.readContract({ address: d.vault, abi, functionName: 'mandates', args: [id] }) as readonly [Address, bigint, bigint, number, number, bigint, bigint, boolean, boolean, bigint]
    const [owner, amountPerRun, interval, maxRuns, runs, expiry, lastRun, , revoked] = m
    if (revoked || runs >= maxRuns || now > expiry) continue
    const run = runs + 1
    const key = `${id}:${run}`
    const existing = await d.db.select().from(mandateRuns).where(eq(mandateRuns.key, key)).get()
    if (existing?.status === 'sent' && existing.txHash) {
      const r = await d.pub.getTransactionReceipt({ hash: existing.txHash as Hex }).catch(() => null)
      if (!r) continue // still pending: never resend
      await d.db.update(mandateRuns).set({ status: r.status === 'success' ? 'done' : 'failed', updatedAt: Number(now) }).where(eq(mandateRuns.key, key))
      if (r.status === 'success') confirmed++
      continue
    }
    if (existing?.status === 'done') continue // chain state will move on next read
    if (runs > 0 && now < lastRun + interval) continue
    const allowance = await d.pub.readContract({ address: d.usdt, abi: usdtAbi, functionName: 'allowance', args: [owner, d.vault] }) as bigint
    if (allowance < amountPerRun) {
      d.log.warn({ mandateId: Number(id) }, 'autosave skipped: allowance too low')
      continue
    }
    if (!existing) await d.db.insert(mandateRuns).values({ key, mandateId: Number(id), run, status: 'pending', updatedAt: Number(now) }).onConflictDoNothing()
    try {
      const hash = await d.sender.send(d.vault, abi, 'executeMandate', [id])
      await d.db.update(mandateRuns).set({ status: 'sent', txHash: hash, updatedAt: Number(now) }).where(eq(mandateRuns.key, key))
      sent++
    } catch (e) {
      d.log.warn({ mandateId: Number(id), run, err: revertReason(e) }, 'autosave run not sent')
      await d.db.update(mandateRuns).set({ status: 'failed', updatedAt: Number(now) }).where(eq(mandateRuns.key, key))
    }
  }
  return { sent, confirmed }
}

// Autosave scheduler. Exactly-once per (mandate, run): the idempotency key `${id}:${run}` is written before sending,
// and a run already `sent` is never resent while its tx is pending. The contract independently enforces interval,
// maxRuns, expiry and revoke, so a duplicate can only fail simulation, never double-charge.
// A1.3 group mandates: one attempt per meeting window (`${id}:${window}` in mandate_windows). A window the member already
// paid by hand is `skipped` (the contract reverts AlreadyContributed); a failure (balance, allowance) is `failed` with its
// reason and is not retried until the next window.
import { parseAbi, type Abi, type Address, type Hex, type PublicClient } from 'viem'
import type { Logger } from 'pino'
import { PocketVaultAbi, GroupKittyAbi } from '@kittora/core'
import { mandateRuns, mandateWindows, eq, type Db } from './db.ts'
import { revertReason, type TxSender } from './chain.ts'
import { usdtAbi } from './actions.ts'

const abi = PocketVaultAbi as Abi
/** executeMandate can revert inside GroupKitty or the token: include their errors so the reason decodes by name. */
const execAbi = [
  ...PocketVaultAbi,
  ...(GroupKittyAbi as Abi).filter(x => x.type === 'error'),
  ...parseAbi(['error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)', 'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)']),
] as Abi

export interface SchedulerDeps {
  pub: PublicClient
  sender: TxSender
  db: Db
  log: Logger
  vault: Address
  usdt: Address
  /** GroupKitty, to find the meeting window of a group mandate (A1.3). */
  group?: Address
  now?: () => number
}

/** Meeting window index of group `g` at `now` (same formula as GroupKitty.meetingIndex). */
async function windowOf(d: SchedulerDeps, g: bigint, now: bigint): Promise<bigint> {
  const gk = GroupKittyAbi as Abi
  const [st, p] = await Promise.all([
    d.pub.readContract({ address: d.group!, abi: gk, functionName: 'groupState', args: [g] }) as Promise<readonly unknown[]>,
    d.pub.readContract({ address: d.group!, abi: gk, functionName: 'groupParams', args: [g] }) as Promise<{ meetingInterval: bigint }>,
  ])
  const startAt = st[1] as bigint
  return now > startAt ? (now - startAt) / p.meetingInterval : 0n
}

export async function schedulerTick(d: SchedulerDeps): Promise<{ sent: number, confirmed: number }> {
  let sent = 0
  let confirmed = 0
  const now = BigInt(Math.floor((d.now ?? Date.now)() / 1000))
  const count = await d.pub.readContract({ address: d.vault, abi, functionName: 'mandateCount' }) as bigint
  for (let id = 1n; id <= count; id++) {
    const m = await d.pub.readContract({ address: d.vault, abi, functionName: 'mandates', args: [id] }) as readonly [Address, bigint, bigint, number, number, bigint, bigint, boolean, boolean, bigint]
    const [owner, amountPerRun, interval, maxRuns, runs, expiry, lastRun, toGroup, revoked, destId] = m
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
    // A1.3: a group mandate gets one attempt per meeting window
    let wkey: string | null = null
    let win = 0n
    if (toGroup && d.group) {
      win = await windowOf(d, destId, now)
      wkey = `${id}:${win}`
      const tried = await d.db.select().from(mandateWindows).where(eq(mandateWindows.key, wkey)).get()
      if (tried) continue
    }
    const noteWindow = async (status: 'sent' | 'skipped' | 'failed', reason: string | null, txHash: string | null) => {
      if (!wkey) return
      await d.db.insert(mandateWindows).values({ key: wkey, mandateId: Number(id), groupId: Number(destId), member: owner.toLowerCase(), windowIdx: Number(win), status, reason, txHash, updatedAt: Number(now) }).onConflictDoNothing()
    }
    const allowance = await d.pub.readContract({ address: d.usdt, abi: usdtAbi, functionName: 'allowance', args: [owner, d.vault] }) as bigint
    if (allowance < amountPerRun) {
      d.log.warn({ mandateId: Number(id) }, 'autosave skipped: allowance too low')
      await noteWindow('failed', 'Kittora is not allowed to use enough USDT (allowance too low). Set up the Autosave again.', null)
      continue
    }
    if (!existing) await d.db.insert(mandateRuns).values({ key, mandateId: Number(id), run, status: 'pending', updatedAt: Number(now) }).onConflictDoNothing()
    try {
      const hash = await d.sender.send(d.vault, execAbi, 'executeMandate', [id])
      await d.db.update(mandateRuns).set({ status: 'sent', txHash: hash, updatedAt: Number(now) }).where(eq(mandateRuns.key, key))
      await noteWindow('sent', null, hash)
      sent++
    } catch (e) {
      const reason = revertReason(e)
      d.log.warn({ mandateId: Number(id), run, err: reason }, 'autosave run not sent')
      await d.db.update(mandateRuns).set({ status: 'failed', updatedAt: Number(now) }).where(eq(mandateRuns.key, key))
      if (/AlreadyContributed/.test(reason)) await noteWindow('skipped', 'Already paid by hand this meeting', null)
      else await noteWindow('failed', plainReason(reason), null)
    }
  }
  return { sent, confirmed }
}

/** Contract / token revert → words for the feed's "Failed" row. */
export function plainReason(r: string): string {
  if (/ERC20InsufficientBalance|exceeds balance|insufficient balance/i.test(r)) return 'Not enough USDT in the wallet for this meeting'
  if (/ERC20InsufficientAllowance|allowance/i.test(r)) return 'Kittora is not allowed to use enough USDT (allowance too low)'
  if (/MeetingLimit/.test(r)) return 'Above the most shares allowed this meeting'
  if (/PoolCapExceeded/.test(r)) return 'The group reached its 500 USDT pilot limit'
  if (/CycleEnded/.test(r)) return 'The group cycle has ended'
  if (/NotMember/.test(r)) return 'No longer a member of the group'
  return r.length > 120 ? `${r.slice(0, 117)}…` : r || 'The run could not be sent'
}

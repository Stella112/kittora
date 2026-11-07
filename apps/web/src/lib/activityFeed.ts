// Activity tab: indexed contract events (source of truth) merged with this viewer's own local submissions (pending,
// failed and Nimiq steps that never reach the Polygon index). One row per transaction.
import type { ActivityItem } from './activity.ts'
import type { ChainActivity } from './relayer.ts'

export interface FeedRow {
  hash: string
  chain: 'polygon' | 'nimiq'
  status: 'pending' | 'confirmed' | 'failed'
  labels: string[]
  ts: number | null
  tone: 'normal' | 'good' | 'bad'
}

const KINDS = ['Flex', 'Target', 'SafeLock', 'Bond']

/** micro-USDT (decimal string or bigint) → "1,234.56" */
export function fmtUsdt(v: unknown): string {
  const n = BigInt(String(v ?? 0))
  const whole = n / 1_000_000n
  const cents = (n % 1_000_000n) / 10_000n
  return `${whole.toLocaleString('en-US')}.${cents.toString().padStart(2, '0')}`
}

const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()

/** Plain-words label for one event, from the viewer's point of view. */
export function describe(e: Pick<ChainActivity, 'event' | 'args'>, me: string): { text: string, tone: FeedRow['tone'] } {
  const a = e.args
  const u = (k: string) => `${fmtUsdt(a[k])} USDT`
  const t = (text: string, tone: FeedRow['tone'] = 'normal') => ({ text, tone })
  switch (e.event) {
    case 'PocketOpened': return t(`Opened ${KINDS[Number(a.kind)] ?? 'a'} pocket #${a.pocketId}`)
    case 'Deposited': return t(`Saved ${u('amount')} in pocket #${a.pocketId}`, 'good')
    case 'Withdrawn': return t(`Withdrew ${u('amount')} from pocket #${a.pocketId}`)
    case 'MandateCreated': return t(`Set up Autosave: ${u('amountPerRun')} per run`)
    case 'MandateExecuted': return t(`Autosave run ${a.run}: ${u('amount')}`, 'good')
    case 'MandateRevoked': return t(`Stopped Autosave #${a.mandateId}`)
    case 'BondLocked': return t(`NIM SafeLock: bonded ${u('amount')}`)
    case 'BondClaimed': return t(`NIM SafeLock bond returned: ${u('amount')}`, 'good')
    case 'BondForfeited': return t(`NIM SafeLock bond forfeited: ${u('amount')}`, 'bad')
    case 'GroupCreated': return t(`Started group #${a.groupId}`)
    case 'MemberJoined': return t(`Joined group #${a.groupId}`)
    case 'SharesBought': {
      const social = BigInt(String(a.social ?? 0))
      const via = same(a.payer, me) ? '' : ' (Autosave)'
      return t(`Bought ${a.shares} share${String(a.shares) === '1' ? '' : 's'} in group #${a.groupId}${social > 0n ? ` + ${fmtUsdt(social)} social fund` : ''}${via}`, 'good')
    }
    case 'LoanRequested':
      return same(a.borrower, me)
        ? t(`Asked for a ${u('principal')} loan (#${a.loanId})`)
        : t(`Asked to guarantee loan #${a.loanId} (${u('principal')})`)
    case 'LoanApproved': return same(a.member, me) ? t(`You approved loan #${a.loanId}`) : t(`Loan #${a.loanId} got an approval`)
    case 'LoanCancelled': return t(`Loan #${a.loanId} cancelled`)
    case 'LoanDisbursed': return t(`Loan #${a.loanId} paid out: ${u('amount')}`, 'good')
    case 'LoanRepaid': {
      const left = BigInt(String(a.remaining ?? 0))
      return t(`${same(a.payer, me) ? 'You repaid' : 'Repaid'} ${u('amount')} on loan #${a.loanId}${left === 0n ? ' (fully repaid)' : `, ${fmtUsdt(left)} left`}`, left === 0n ? 'good' : 'normal')
    }
    case 'LoanDefaulted': return t(`Loan #${a.loanId} defaulted: ${u('writtenOff')} written off from shares`, 'bad')
    case 'SocialPayoutProposed':
      return same(a.recipient, me)
        ? t(`Social fund payment proposed for you: ${u('amount')}`)
        : t(`Proposed a social fund payment of ${u('amount')}`)
    case 'SocialPayoutApproved': return same(a.member, me) ? t('You approved a social fund payment') : t('A social fund payment you proposed got an approval')
    case 'SocialPayoutExecuted': return same(a.recipient, me) ? t(`Social fund payment received: ${u('amount')}`, 'good') : t(`Social fund payment made: ${u('amount')}`)
    case 'GroupProfileUpdated': return t(`Group profile: ${String(a.name)}`)
    case 'RoleChanged': {
      const role = ['removed', 'Member', 'Treasurer', 'Admin'][Number(a.newRole)] ?? 'Member'
      return same(a.member, me) ? t(Number(a.newRole) === 0 ? `You left group #${a.groupId}` : `You are now ${role} in group #${a.groupId}`) : t(`Role change in group #${a.groupId}`)
    }
    case 'MemberRemoved': return same(a.member, me) ? t(`You were removed from group #${a.groupId}`, 'bad') : t(`Removed a member from group #${a.groupId}`)
    case 'ShareOutClaimed': {
      const rolled = String(a.rolledIntoPocket ?? '0') !== '0'
      return t(`Share-Out from group #${a.groupId}: ${u('amount')}${rolled ? ` into pocket #${a.rolledIntoPocket}` : ' to your wallet'}`, 'good')
    }
    default: return t(e.event)
  }
}

const rank = { bad: 2, good: 1, normal: 0 } as const

export function buildFeed(chain: ChainActivity[], local: ActivityItem[], me: string): FeedRow[] {
  const rows = new Map<string, FeedRow>()
  // chain items arrive newest first; keep each transaction's events in on-chain order
  for (const e of [...chain].reverse()) {
    const k = e.hash.toLowerCase()
    const d = describe(e, me)
    const row = rows.get(k) ?? { hash: e.hash, chain: 'polygon' as const, status: 'confirmed' as const, labels: [], ts: e.ts ?? null, tone: 'normal' as const }
    if (!row.labels.includes(d.text)) row.labels.push(d.text)
    if (rank[d.tone] > rank[row.tone]) row.tone = d.tone
    rows.set(k, row)
  }
  for (const l of local) {
    const k = l.hash.toLowerCase()
    const existing = rows.get(k)
    if (existing) {
      // on-chain facts win; the local timestamp is more precise than the block time only when the block is unknown
      existing.ts ??= Math.floor(l.ts / 1000)
      continue
    }
    rows.set(k, { hash: l.hash, chain: l.chain, status: l.status, labels: [l.label], ts: Math.floor(l.ts / 1000), tone: l.status === 'failed' ? 'bad' : 'normal' })
  }
  return [...rows.values()].sort((a, b) => (b.ts ?? Infinity) - (a.ts ?? Infinity))
}

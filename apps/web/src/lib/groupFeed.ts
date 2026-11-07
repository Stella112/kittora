// A1.2 group feed v2: one row per group event with initiator, approvers, status and links.
// Status never comes from optimistic UI state: chain logs = Confirmed (receipt verified), open requests read their live
// contract state (Pending approval / Approved / Expired), and Submitted / Failed come from the relayer's own tracking.
import { LoanStatus, Role, loanReady, payoutExpired, payoutReady, canApprovePayout, officerNeeded, same, type GroupDetail, type LoanView, type PayoutView } from './groupMath.ts'
import type { GroupFeedRow } from './relayer.ts'

export type FeedKind =
  | 'contribution' | 'mandate-run' | 'social' | 'loan-request' | 'approval' | 'disbursement' | 'repayment' | 'default'
  | 'payout-proposal' | 'payout-executed' | 'share-out' | 'profile' | 'role' | 'member' | 'mandate'
export type FeedStatus = 'Pending approval' | 'Approved' | 'Submitted' | 'Confirmed' | 'Failed' | 'Expired' | 'Skipped'
export type FeedFilter = 'all' | 'money' | 'loans' | 'approvals'

export interface FeedRowV2 {
  key: string
  kind: FeedKind
  title: string
  detail?: string
  actor: string | null // address, 'autosave', or null (permissionless call)
  amount: bigint | null
  approvals?: { have: number, need: number, who: string[], note?: string }
  status: FeedStatus
  hash?: string
  ts: number | null
  tags: FeedFilter[]
}

type G = Pick<GroupDetail, 'p' | 'now' | 'loans' | 'payouts' | 'members' | 'treasurers' | 'admin' | 'relays' | 'autosaveWindows'>

const ROLE_NAME = ['removed', 'Member', 'Treasurer', 'Admin']
const big = (v: unknown) => BigInt(String(v ?? 0))
const ACTION_LABEL: Record<string, [FeedKind, string]> = {
  'group.buyShares': ['contribution', 'Buying shares'],
  'group.join': ['member', 'Joining the group'],
  'group.createGroup': ['member', 'Starting the group'],
  'group.requestLoan': ['loan-request', 'Loan request'],
  'group.approveLoan': ['approval', 'Loan approval'],
  'group.cancelLoan': ['loan-request', 'Cancelling a loan request'],
  'group.disburse': ['disbursement', 'Paying out a loan'],
  'group.repay': ['repayment', 'Repayment'],
  'group.markDefault': ['default', 'Settling a default'],
  'group.proposeSocialPayout': ['payout-proposal', 'Social fund payment proposal'],
  'group.approveSocialPayout': ['approval', 'Social fund payment approval'],
  'group.executeSocialPayout': ['payout-executed', 'Paying a social fund payment'],
  'group.claimShareOut': ['share-out', 'Share-Out claim'],
  'group.updateProfile': ['profile', 'Profile change'],
  'group.setTreasurer': ['role', 'Role change'],
  'group.transferAdmin': ['role', 'Admin hand-over'],
  'group.removeMember': ['member', 'Removing a member'],
}

function tagsFor(kind: FeedKind, ref?: { loan?: boolean }): FeedFilter[] {
  const t: FeedFilter[] = ['all']
  if (kind === 'contribution' || kind === 'mandate-run' || kind === 'social' || kind === 'repayment') t.push('money')
  if (kind === 'loan-request' || kind === 'disbursement' || kind === 'repayment' || kind === 'default' || (kind === 'approval' && ref?.loan)) t.push('loans')
  if (kind === 'approval' || kind === 'loan-request' || kind === 'payout-proposal') t.push('approvals')
  return t
}

function loanApprovals(l: LoanView, g: G, who: string[]) {
  const need = Math.max(g.p.approvalsRequired, 0)
  const note = l.guarantors.length ? `${l.guarantorApprovals} of ${l.guarantors.length} guarantors` : undefined
  return { have: l.approvals, need, who, note }
}

function payoutApprovals(po: PayoutView, g: G, who: string[]) {
  const noTreasurer = g.treasurers.length === 0
  const officerOk = po.treasurerApproved || (noTreasurer && po.adminApproved)
  return { have: po.approvals, need: g.p.approvalsRequired, who, note: officerOk ? undefined : noTreasurer ? 'needs the Admin' : 'needs a Treasurer' }
}

function loanStatus(l: LoanView | undefined, g: G): FeedStatus {
  if (!l || l.status !== LoanStatus.Requested) return 'Confirmed'
  return loanReady(l, g as GroupDetail) ? 'Approved' : 'Pending approval'
}

function payoutStatus(po: PayoutView | undefined, g: G): FeedStatus {
  if (!po || po.executed) return 'Confirmed'
  if (payoutExpired(po, g)) return 'Expired'
  return payoutReady(po, g) ? 'Approved' : 'Pending approval'
}

/** Build the feed from chain rows + live state + relayer tracking. Newest first. */
export function buildGroupFeed(items: GroupFeedRow[], g: G, approvers: { loans: Record<string, string[]>, payouts: Record<string, string[]> } = { loans: {}, payouts: {} }): FeedRowV2[] {
  const rows: FeedRowV2[] = []
  const loan = (id: unknown) => g.loans.find(l => String(l.id) === String(id))
  const payout = (id: unknown) => g.payouts.find(p => String(p.id) === String(id))
  const chainHashes = new Set(items.map(i => i.hash.toLowerCase()))

  for (const i of items) {
    const a = i.args
    const base = { key: `${i.hash}:${i.logIndex}`, hash: i.hash, ts: i.ts ?? null, actor: i.actor ?? null }
    const push = (kind: FeedKind, title: string, extra: Partial<FeedRowV2> = {}, ref?: { loan?: boolean }) =>
      rows.push({ ...base, kind, title, amount: null, status: 'Confirmed', tags: tagsFor(kind, ref), ...extra })
    switch (i.event) {
      case 'GroupCreated': push('member', 'Started the group'); break
      case 'GroupProfileUpdated': push('profile', `Profile: ${String(a.name)}`, { detail: String(a.purpose ?? '') || undefined }); break
      case 'RoleChanged': {
        const nr = Number(a.newRole)
        if (Number(a.oldRole) === 0 && nr === 3) break // creator becoming Admin at creation is shown as "Started the group"
        push('role', nr === 0 ? 'Member removed from their role' : `Now ${ROLE_NAME[nr]}`, { detail: String(a.member) })
        break
      }
      case 'MemberJoined': push('member', 'Joined the group'); break
      case 'MemberRemoved': push('member', 'Removed a member', { detail: String(a.member) }); break
      case 'SharesBought': {
        const shares = big(a.shares)
        const social = big(a.social)
        const amount = shares * g.p.sharePrice + social
        const label = `${shares} share${shares === 1n ? '' : 's'}${social > 0n ? ' + social fund' : ''}`
        if (i.actor === 'autosave') push('mandate-run', `Autosave: ${label}`, { amount, detail: String(a.member), actor: 'autosave' })
        else push('contribution', label, { amount })
        break
      }
      case 'ForfeitReceived': push('social', 'Bond forfeit added to the social fund', { amount: big(a.amount) }); break
      case 'LoanRequested': {
        const l = loan(a.loanId)
        push('loan-request', `Loan request #${a.loanId}`, {
          amount: big(a.principal),
          status: loanStatus(l, g),
          approvals: l ? loanApprovals(l, g, approvers.loans[String(a.loanId)] ?? []) : undefined,
        }, { loan: true })
        break
      }
      case 'LoanApproved': push('approval', `Approved loan #${a.loanId}`, {}, { loan: true }); break
      case 'LoanCancelled': push('loan-request', `Loan request #${a.loanId} cancelled`, {}, { loan: true }); break
      case 'LoanDisbursed': push('disbursement', `Loan #${a.loanId} paid out`, { amount: big(a.amount) }); break
      case 'LoanRepaid': push('repayment', `Repaid loan #${a.loanId}`, { amount: big(a.amount), detail: big(a.remaining) === 0n ? 'fully repaid' : undefined }); break
      case 'LoanDefaulted': push('default', `Default settled on loan #${a.loanId}`, { amount: big(a.writtenOff), detail: 'written off from shares' }); break
      case 'SocialPayoutProposed': {
        const po = payout(a.payoutId)
        push('payout-proposal', `Social fund payment proposed`, {
          amount: big(a.amount),
          detail: `to ${String(a.recipient)}: ${String(a.reason)}`,
          status: payoutStatus(po, g),
          approvals: po ? payoutApprovals(po, g, approvers.payouts[String(a.payoutId)] ?? []) : undefined,
        })
        break
      }
      case 'SocialPayoutApproved': push('approval', 'Approved a social fund payment'); break
      case 'SocialPayoutExecuted': push('payout-executed', 'Social fund payment made', { amount: big(a.amount), detail: `to ${String(a.recipient)}` }); break
      case 'ShareOutClaimed': push('share-out', 'Claimed Share-Out', { amount: big(a.amount) }); break
      case 'GroupMandateCreated': push('mandate', 'Set up Autosave for every meeting', { amount: big(a.amountPerRun) }); break
      case 'GroupMandateRevoked': push('mandate', 'Stopped Autosave'); break
    }
  }

  // relayer tracking: sent but not yet on-chain (Submitted), or failed on-chain (Failed)
  for (const r of g.relays) {
    if (chainHashes.has(r.hash.toLowerCase()) && r.status === 'submitted') continue
    const [kind, label] = ACTION_LABEL[r.action] ?? ['member', 'Group action']
    rows.push({
      key: `relay:${r.hash}`, kind, title: label, actor: r.signer || null, amount: null, hash: r.hash, ts: r.createdAt,
      status: r.status === 'failed' ? 'Failed' : 'Submitted', tags: tagsFor(kind, { loan: kind === 'approval' && r.action === 'group.approveLoan' }),
    })
  }

  // Autosave windows that did not buy (A1.3)
  for (const w of g.autosaveWindows) {
    if (w.status === 'sent') continue
    rows.push({
      key: `window:${w.key}`, kind: 'mandate-run', actor: w.member, amount: null, ts: w.updatedAt,
      title: w.status === 'skipped' ? `Autosave skipped meeting ${w.windowIdx + 1}` : `Autosave missed meeting ${w.windowIdx + 1}`,
      detail: w.reason ?? undefined, status: w.status === 'skipped' ? 'Skipped' : 'Failed', tags: ['all', 'money'],
    })
  }

  return rows.sort((x, y) => (y.ts ?? Number.MAX_SAFE_INTEGER) - (x.ts ?? Number.MAX_SAFE_INTEGER))
}

export const applyFilter = (rows: FeedRowV2[], f: FeedFilter) => rows.filter(r => r.tags.includes(f))

/** Things waiting on `me` (pinned at the top of the group screen), and things anyone can push forward. */
export interface Pending {
  kind: 'loan' | 'payout'
  id: bigint
  action: 'approve' | 'guarantee' | 'payout' | 'execute'
  title: string
  amount: bigint
  officer?: boolean // my approval also satisfies the Treasurer / Admin requirement
}

export function pendingForMe(g: Pick<GroupDetail, 'p' | 'now' | 'loans' | 'payouts' | 'members' | 'treasurers' | 'admin' | 'shareOutStarted'>, me: string): Pending[] {
  const out: Pending[] = []
  const isMember = g.members.some(m => same(m.address, me))
  if (!isMember) return out
  for (const l of g.loans) {
    if (l.status !== LoanStatus.Requested) continue
    if (loanReady(l, g as GroupDetail)) { out.push({ kind: 'loan', id: l.id, action: 'payout', title: `Loan #${l.id} is approved: pay it out`, amount: l.principal }); continue }
    if (same(l.borrower, me) || l.approvedBy[me.toLowerCase()]) continue
    const iGuarantee = l.guarantors.some(a => same(a, me))
    out.push({ kind: 'loan', id: l.id, action: iGuarantee ? 'guarantee' : 'approve', title: iGuarantee ? `Guarantee loan #${l.id}` : `Approve loan #${l.id}`, amount: l.principal })
  }
  if (!g.shareOutStarted) {
    for (const po of g.payouts) {
      if (payoutReady(po, g)) { out.push({ kind: 'payout', id: po.id, action: 'execute', title: 'Social fund payment approved: pay it', amount: po.amount }); continue }
      if (!canApprovePayout(po, me, g)) continue
      const { missing, iAmOfficer } = officerNeeded(po, g, me)
      out.push({ kind: 'payout', id: po.id, action: 'approve', title: `Approve a social fund payment: ${po.reason}`, amount: po.amount, officer: missing && iAmOfficer })
    }
  }
  // my own approvals first, then the "anyone can do it" pay-outs; officers' items first among approvals
  const rank = (p: Pending) => (p.action === 'payout' || p.action === 'execute' ? 2 : p.officer ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b))
}

export const roleName = (r: Role) => ROLE_NAME[r] ?? 'Member'

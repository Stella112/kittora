import { describe, it, expect } from 'vitest'
import { applyFilter, buildGroupFeed, pendingForMe } from './groupFeed.ts'
import { LoanStatus, Role, type GroupDetail, type LoanView, type PayoutView } from './groupMath.ts'
import type { GroupFeedRow } from './relayer.ts'

const A = '0x00000000000000000000000000000000000000aa'
const B = '0x00000000000000000000000000000000000000bb'
const C = '0x00000000000000000000000000000000000000cc'
const D = '0x00000000000000000000000000000000000000dd'
const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}`

const p = { sharePrice: 1_000_000n, socialFundPerMeeting: 200_000n, meetingInterval: 3600n, cycleEnd: 10_000n, gracePeriod: 600n, interestBps: 1000, maxLoanMultipleBps: 30000, maxSharesPerMeeting: 5, approvalsRequired: 2, maxMembers: 10, maxSocialPayout: 0n }
const member = (address: string, role = Role.Member) => ({ address: address as `0x${string}`, claimed: false, shares: 5n, pledged: 0n, activeLoan: 0n, history: [5n], socialPaidNow: true, role })

function loanReq(over: Partial<LoanView> = {}): LoanView {
  return { id: 1n, borrower: B as `0x${string}`, principal: 8_000_000n, interest: 800_000n, repaid: 0n, owed: 8_800_000n, duration: 3600n, disbursedAt: 0n, approvals: 1, guarantorApprovals: 0, status: LoanStatus.Requested, guarantors: [C as `0x${string}`], pledges: [3n], approvedBy: { [D]: true }, ...over }
}
function payoutReq(over: Partial<PayoutView> = {}): PayoutView {
  return { id: 1n, proposer: B as `0x${string}`, recipient: B as `0x${string}`, amount: 300_000n, expiresAt: 5000n, approvals: 1, treasurerApproved: false, adminApproved: false, executed: false, reason: 'Medical bill', approvedBy: { [D]: true }, ...over }
}
function g(over: Partial<GroupDetail> = {}) {
  return {
    p, now: 1000n, loans: [loanReq()], payouts: [payoutReq()], members: [member(A, Role.Admin), member(B), member(C, Role.Treasurer), member(D)],
    treasurers: [C as `0x${string}`], admin: A as `0x${string}`, relays: [], autosaveWindows: [], shareOutStarted: false, ...over,
  } as unknown as GroupDetail
}
const row = (event: string, args: Record<string, unknown>, n: number, actor?: string): GroupFeedRow =>
  ({ contract: 'group', event, args, hash: h(n), block: String(n), logIndex: 0, ts: n, groupId: '1', ...(actor ? { actor } : {}) })

describe('group feed v2', () => {
  const items = [
    row('SocialPayoutProposed', { payoutId: '1', recipient: B, amount: '300000', reason: 'Medical bill' }, 9, B),
    row('LoanRequested', { loanId: '1', principal: '8000000' }, 8, B),
    row('SharesBought', { member: B, shares: '1', social: '200000' }, 7, 'autosave'),
    row('SharesBought', { member: A, shares: '5', social: '200000' }, 6, A),
    row('RoleChanged', { member: C, oldRole: 1, newRole: 2, by: A }, 5, A),
    row('RoleChanged', { member: A, oldRole: 0, newRole: 3, by: A }, 2, A),
    row('GroupCreated', {}, 1, A),
  ]

  it('maps events to rows with initiator, amount and live status', () => {
    const rows = buildGroupFeed(items, g(), { loans: { 1: [D] }, payouts: { 1: [D] } })
    expect(rows.map(r => r.kind)).toEqual(['payout-proposal', 'loan-request', 'mandate-run', 'contribution', 'role', 'member'])
    const loanRow = rows.find(r => r.kind === 'loan-request')!
    expect(loanRow.status).toBe('Pending approval')
    expect(loanRow.approvals).toEqual({ have: 1, need: 2, who: [D], note: '0 of 1 guarantors' })
    expect(rows.find(r => r.kind === 'mandate-run')).toMatchObject({ actor: 'autosave', amount: 1_200_000n, title: 'Autosave: 1 share + social fund' })
    expect(rows.find(r => r.kind === 'contribution')).toMatchObject({ actor: A, amount: 5_200_000n })
    expect(rows.find(r => r.kind === 'payout-proposal')!.approvals!.note).toBe('needs a Treasurer')
    expect(rows.every(r => r.hash)).toBe(true)
  })

  it('statuses follow the contract: Approved when ready, Expired past expiry, Confirmed once done', () => {
    const ready = g({ loans: [loanReq({ approvals: 2, guarantorApprovals: 1 })], payouts: [payoutReq({ approvals: 2, treasurerApproved: true })] })
    let rows = buildGroupFeed(items, ready)
    expect(rows.find(r => r.kind === 'loan-request')!.status).toBe('Approved')
    expect(rows.find(r => r.kind === 'payout-proposal')!.status).toBe('Approved')
    rows = buildGroupFeed(items, g({ now: 6000n }))
    expect(rows.find(r => r.kind === 'payout-proposal')!.status).toBe('Expired')
    rows = buildGroupFeed(items, g({ loans: [loanReq({ status: LoanStatus.Disbursed })], payouts: [payoutReq({ executed: true })] }))
    expect(rows.find(r => r.kind === 'loan-request')!.status).toBe('Confirmed')
    expect(rows.find(r => r.kind === 'payout-proposal')!.status).toBe('Confirmed')
  })

  it('the Admin stands in for a Treasurer only when there is none', () => {
    const noT = g({ treasurers: [], payouts: [payoutReq({ approvals: 2, adminApproved: true })] })
    expect(buildGroupFeed(items, noT).find(r => r.kind === 'payout-proposal')!.status).toBe('Approved')
    const withT = g({ payouts: [payoutReq({ approvals: 2, adminApproved: true })] })
    expect(buildGroupFeed(items, withT).find(r => r.kind === 'payout-proposal')!.status).toBe('Pending approval')
  })

  it('relayer tracking: Submitted until on-chain, Failed shown; Autosave misses and skips shown', () => {
    const tracked = g({
      relays: [
        { hash: h(99), action: 'group.buyShares', signer: D, groupId: 1, refId: null, status: 'submitted', createdAt: 50 },
        { hash: h(98), action: 'group.repay', signer: B, groupId: 1, refId: 1, status: 'failed', createdAt: 40 },
        { hash: h(9), action: 'group.proposeSocialPayout', signer: B, groupId: 1, refId: null, status: 'submitted', createdAt: 9 }, // already on-chain
      ],
      autosaveWindows: [
        { key: '3:2', mandateId: 3, member: B, windowIdx: 2, status: 'failed', reason: 'Not enough USDT in the wallet for this meeting', txHash: null, updatedAt: 45 },
        { key: '3:1', mandateId: 3, member: B, windowIdx: 1, status: 'skipped', reason: 'Already paid by hand this meeting', txHash: null, updatedAt: 44 },
        { key: '3:0', mandateId: 3, member: B, windowIdx: 0, status: 'sent', reason: null, txHash: h(7), updatedAt: 7 },
      ],
    })
    const rows = buildGroupFeed(items, tracked)
    expect(rows[0]).toMatchObject({ status: 'Submitted', title: 'Buying shares', actor: D })
    expect(rows.filter(r => r.status === 'Submitted')).toHaveLength(1) // the on-chain one is not doubled
    expect(rows.find(r => r.status === 'Failed' && r.kind === 'repayment')).toBeDefined()
    expect(rows.find(r => r.title === 'Autosave missed meeting 3')).toMatchObject({ status: 'Failed', detail: 'Not enough USDT in the wallet for this meeting' })
    expect(rows.find(r => r.title === 'Autosave skipped meeting 2')!.status).toBe('Skipped')
    expect(rows.some(r => r.key === 'window:3:0')).toBe(false) // a run that bought shows as its on-chain row
  })

  it('filters: money in, loans, approvals', () => {
    const rows = buildGroupFeed([...items, row('LoanApproved', { loanId: '1' }, 10, C), row('LoanRepaid', { loanId: '1', amount: '8800000', remaining: '0' }, 11, B)], g())
    expect(applyFilter(rows, 'money').map(r => r.kind).sort()).toEqual(['contribution', 'mandate-run', 'repayment'])
    expect(applyFilter(rows, 'loans').map(r => r.kind).sort()).toEqual(['approval', 'loan-request', 'repayment'])
    expect(applyFilter(rows, 'approvals').map(r => r.kind).sort()).toEqual(['approval', 'loan-request', 'payout-proposal'])
  })
})

describe('pinned: what needs me', () => {
  it('guarantor, approver, officer, and never the borrower / proposer / recipient', () => {
    expect(pendingForMe(g(), C).map(p => `${p.kind}:${p.action}:${p.officer ?? ''}`)).toEqual(['payout:approve:true', 'loan:guarantee:'])
    expect(pendingForMe(g(), A).map(p => `${p.kind}:${p.action}`)).toEqual(['loan:approve', 'payout:approve'])
    expect(pendingForMe(g(), B)).toEqual([]) // borrower and proposer/recipient
    expect(pendingForMe(g(), D)).toEqual([]) // already approved both
    expect(pendingForMe(g(), '0x00000000000000000000000000000000000000ee')).toEqual([]) // not a member
  })

  it('ready items invite anyone to push them through; nothing after Share-Out starts for payments', () => {
    const ready = g({ loans: [loanReq({ approvals: 2, guarantorApprovals: 1 })], payouts: [payoutReq({ approvals: 2, treasurerApproved: true })] })
    expect(pendingForMe(ready, B).map(p => p.action).sort()).toEqual(['execute', 'payout'])
    expect(pendingForMe({ ...ready, shareOutStarted: true }, B).map(p => p.action)).toEqual(['payout'])
  })
})

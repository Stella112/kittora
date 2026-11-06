// Pure Group Kitty math and types (no browser or network imports, so it is unit-testable).
import type { Address } from 'viem'

export interface GroupParams {
  sharePrice: bigint
  socialFundPerMeeting: bigint
  meetingInterval: bigint
  cycleEnd: bigint
  gracePeriod: bigint
  interestBps: number
  maxLoanMultipleBps: number
  maxSharesPerMeeting: number
  approvalsRequired: number
  maxMembers: number
}

export interface MemberRow {
  address: Address
  claimed: boolean
  shares: bigint
  pledged: bigint
  activeLoan: bigint
  /** Shares bought per meeting, oldest first, ending with the current meeting. */
  history: bigint[]
  socialPaidNow: boolean
}

export enum LoanStatus { None, Requested, Disbursed, Repaid, Defaulted, Cancelled }

export interface LoanView {
  id: bigint
  borrower: Address
  principal: bigint
  interest: bigint
  repaid: bigint
  owed: bigint
  duration: bigint
  disbursedAt: bigint
  approvals: number
  guarantorApprovals: number
  status: LoanStatus
  guarantors: Address[]
  pledges: bigint[]
  approvedBy: Record<string, boolean>
}

export interface GrantView { id: bigint, member: Address, amount: bigint, approvals: number, paid: boolean, approvedBy: Record<string, boolean> }

export interface GroupDetail {
  id: bigint
  p: GroupParams
  creator: Address
  startAt: bigint
  memberCount: number
  activeLoans: number
  cash: bigint
  socialFund: bigint
  outstanding: bigint
  totalShares: bigint
  shareOutStarted: boolean
  /** Chain time (latest block) when loaded: the contract's clock, not the phone's. */
  now: bigint
  /** chain time − phone time, in seconds, to keep countdowns on the contract's clock. */
  skew: number
  meeting: bigint
  totalMeetings: bigint
  nextMeetingAt: bigint
  members: MemberRow[]
  me: MemberRow | null
  /** USDT value of one share in micro-USDT (pool value per share, social fund excluded). */
  shareValue: bigint
  loans: LoanView[]
  grants: GrantView[]
}

/** Value of `shares` at the current pool value: mirrors GroupKitty.valueOfShares. */
export function valueOf(g: Pick<GroupDetail, 'totalShares' | 'cash' | 'outstanding' | 'p'>, shares: bigint) {
  if (g.totalShares === 0n) return shares * g.p.sharePrice
  return (shares * (g.cash + g.outstanding)) / g.totalShares
}

/**
 * Mirrors GroupKitty._checkLimit: principal ≤ own unpledged value × multiple, and ≤ own value + pledged value.
 * Each pledge is valued separately (same rounding as the contract).
 */
export function loanCheck(g: Pick<GroupDetail, 'totalShares' | 'cash' | 'outstanding' | 'p'>, me: Pick<MemberRow, 'shares' | 'pledged'>, principal: bigint, pledges: bigint[]) {
  const ownValue = valueOf(g, me.shares - me.pledged)
  const multipleCap = (ownValue * BigInt(g.p.maxLoanMultipleBps)) / 10_000n
  const pledgedValue = pledges.reduce((s, n) => s + valueOf(g, n), 0n)
  const cover = ownValue + pledgedValue
  return { ownValue, multipleCap, pledgedValue, cover, overMultiple: principal > multipleCap, needCover: principal > cover ? principal - cover : 0n }
}

export const dueAt =(l: LoanView) => l.disbursedAt + l.duration
export const defaultableAt = (l: LoanView, g: GroupDetail) => dueAt(l) + g.p.gracePeriod + 1n
export const loanReady = (l: LoanView, g: GroupDetail) => l.status === LoanStatus.Requested && l.approvals >= g.p.approvalsRequired && l.guarantorApprovals === l.guarantors.length

/** Share-Out estimate before the snapshot: cash × shares / totalShares + social fund / members. */
export function shareOutEstimate(g: GroupDetail, shares: bigint) {
  const own = g.totalShares > 0n ? (g.cash * shares) / g.totalShares : 0n
  return own + (g.memberCount > 0 ? g.socialFund / BigInt(g.memberCount) : 0n)
}


/** Accepts a group number, or an invite link (Kittora or Nimiq Pay universal link) ending in /groups/<id>. */
export function parseGroupRef(input: string): bigint | null {
  const s = input.trim()
  if (/^\d{1,12}$/.test(s)) return BigInt(s) > 0n ? BigInt(s) : null
  const m = s.match(/\/groups\/(\d{1,12})(?:[/?#]|$)/)
  return m && BigInt(m[1]) > 0n ? BigInt(m[1]) : null
}

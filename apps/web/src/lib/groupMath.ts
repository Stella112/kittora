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
  /** A1.5: largest single social fund payment; 0 = no cap beyond the fund balance. */
  maxSocialPayout: bigint
}

/** A1.1: plain text from the contract (never rendered as HTML). */
export interface GroupProfile { name: string, purpose: string, coverId: number }

/** A1.4: mirrors GroupKitty.Role. */
export enum Role { None, Member, Treasurer, Admin }

export interface MemberRow {
  address: Address
  claimed: boolean
  shares: bigint
  pledged: bigint
  activeLoan: bigint
  /** Shares bought per meeting, oldest first, ending with the current meeting. */
  history: bigint[]
  socialPaidNow: boolean
  role: Role
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

/** A1.5: a social fund payment proposal. */
export interface PayoutView {
  id: bigint
  proposer: Address
  recipient: Address
  amount: bigint
  expiresAt: bigint
  approvals: number
  treasurerApproved: boolean
  adminApproved: boolean
  executed: boolean
  reason: string
  approvedBy: Record<string, boolean>
}

/** Group Autosave mandate (vault), for the Members tab. */
export interface GroupMandate { id: bigint, owner: Address, amountPerRun: bigint, runs: number, maxRuns: number, expiry: bigint, revoked: boolean, active: boolean }

/** Relayer tracking (A1.2 / A1.3): relays not yet confirmed, and Autosave windows that were skipped or failed. */
export interface RelayTrack { hash: string, action: string, signer: string, groupId: number | null, refId: number | null, status: 'submitted' | 'failed', createdAt: number }
export interface AutosaveWindow { key: string, mandateId: number, member: string, windowIdx: number, status: 'sent' | 'skipped' | 'failed', reason: string | null, txHash: string | null, updatedAt: number }

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
  payouts: PayoutView[]
  profile: GroupProfile
  admin: Address
  treasurers: Address[]
  mandates: GroupMandate[]
  relays: RelayTrack[]
  autosaveWindows: AutosaveWindow[]
  /** Who approved each loan / payment (from the relayer index of approval events). */
  approvers: { loans: Record<string, string[]>, payouts: Record<string, string[]> }
}

export const payoutExpired = (po: PayoutView, g: Pick<GroupDetail, 'now'>) => !po.executed && g.now > po.expiresAt
/** Mirrors executeSocialPayout's approval rule: enough approvals and a Treasurer (or the Admin while there is none). */
export const payoutReady = (po: PayoutView, g: Pick<GroupDetail, 'now' | 'p' | 'treasurers'>) =>
  !po.executed && g.now <= po.expiresAt && po.approvals >= g.p.approvalsRequired && (po.treasurerApproved || (g.treasurers.length === 0 && po.adminApproved))

/** Who may approve a payout: members other than the proposer and the recipient, who have not approved yet. */
export const canApprovePayout = (po: PayoutView, me: string, g: Pick<GroupDetail, 'now'>) =>
  !po.executed && g.now <= po.expiresAt && !same(me, po.proposer) && !same(me, po.recipient) && !po.approvedBy[me.toLowerCase()]

/** Does this payout still need an officer (Treasurer, or Admin when there is none) and is `me` one? */
export function officerNeeded(po: PayoutView, g: Pick<GroupDetail, 'treasurers' | 'admin'>, me: string) {
  const noTreasurer = g.treasurers.length === 0
  const missing = !po.treasurerApproved && !(noTreasurer && po.adminApproved)
  const iAmOfficer = noTreasurer ? same(me, g.admin) : g.treasurers.some(t => same(t, me))
  return { missing, iAmOfficer }
}

export const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase())

/** UTF-8 byte length: the unit the contract limits profile text and reasons by. */
export const byteLen = (s: string) => new TextEncoder().encode(s).length

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

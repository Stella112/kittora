// Live reads for one Group Kitty. Loan / payment / mandate ids come from the relayer index; every value is read from
// the contracts (multicall-batched by the reader client). Relay and Autosave tracking come from the relayer.
import { useQuery } from '@tanstack/react-query'
import { getAddress, type Abi, type Address } from 'viem'
import { GroupKittyAbi, PocketVaultAbi } from '@kittora/core'
import { config, contractsDeployed } from '../config.ts'
import { reader } from './evm.ts'
import { relayer } from './relayer.ts'
import { noteChainTime } from './chainActions.ts'
import { LoanStatus, Role, same, valueOf, type GroupDetail, type GroupMandate, type GroupParams, type GroupProfile, type LoanView, type MemberRow, type PayoutView } from './groupMath.ts'

export * from './groupMath.ts'

const abi = GroupKittyAbi as Abi
const vaultAbi = PocketVaultAbi as Abi
const ZERO = '0x0000000000000000000000000000000000000000'
/** Meetings shown on the group board (current one included). */
export const BOARD_MEETINGS = 4

/** Shortened address in checksum case, so the same member always looks the same. */
export const short = (a: string) => {
  let c = a
  try { c = getAddress(a) } catch { /* not an address: show as given */ }
  return `${c.slice(0, 6)}…${c.slice(-4)}`
}

export async function loadGroup(id: bigint, me: Address | null): Promise<GroupDetail | null> {
  const r = reader()
  const gk = config.groupKitty!
  const read = <T>(functionName: string, args: unknown[] = []) => r.readContract({ address: gk, abi, functionName, args }) as Promise<T>

  const [p, st, list, profile, admin, index, block] = await Promise.all([
    read<GroupParams>('groupParams', [id]),
    read<readonly [Address, bigint, number, number, bigint, bigint, bigint, bigint, boolean]>('groupState', [id]),
    read<Address[]>('memberList', [id]),
    read<GroupProfile>('profile', [id]),
    read<Address>('adminOf', [id]),
    relayer.group(id),
    r.getBlock({ blockTag: 'latest' }),
  ])
  if (st[0] === ZERO) return null
  const now = block.timestamp
  noteChainTime(now)
  const skew = Number(now) - Math.floor(Date.now() / 1000)
  const [creator, startAt, memberCount, activeLoans, cash, socialFund, outstanding, totalShares, shareOutStarted] = st
  const meeting = now > startAt ? (now - startAt) / p.meetingInterval : 0n
  const totalMeetings = (p.cycleEnd - startAt + p.meetingInterval - 1n) / p.meetingInterval
  const first = meeting >= BigInt(BOARD_MEETINGS - 1) ? meeting - BigInt(BOARD_MEETINGS - 1) : 0n
  const meetings: bigint[] = []
  for (let m = first; m <= meeting; m++) meetings.push(m)

  const members = await Promise.all(list.map(async (a): Promise<MemberRow> => {
    const [m, history, socialPaidNow, role] = await Promise.all([
      read<readonly [boolean, boolean, bigint, bigint, bigint]>('members', [id, a]),
      Promise.all(meetings.map(i => read<bigint>('sharesInMeeting', [id, a, i]))),
      read<boolean>('socialPaid', [id, a, meeting]),
      read<number>('roleOf', [id, a]),
    ])
    return { address: a, claimed: m[1], shares: m[2], pledged: m[3], activeLoan: m[4], history, socialPaidNow, role: role as Role }
  }))
  const addrs = list.map(a => a.toLowerCase())

  const loans = await Promise.all(index.loanIds.map(async (s): Promise<LoanView> => {
    const lid = BigInt(s)
    const [l, owed] = await Promise.all([
      read<{ borrower: Address, principal: bigint, interest: bigint, repaid: bigint, duration: bigint, disbursedAt: bigint, approvals: number, guarantorApprovals: number, status: number, guarantors: readonly Address[], pledges: readonly bigint[] }>('loan', [lid]),
      read<bigint>('owed', [lid]),
    ])
    const flags = await Promise.all(addrs.map(a => read<boolean>('loanApprovedBy', [lid, a])))
    return {
      id: lid, borrower: l.borrower, principal: l.principal, interest: l.interest, repaid: l.repaid, owed, duration: l.duration, disbursedAt: l.disbursedAt,
      approvals: l.approvals, guarantorApprovals: l.guarantorApprovals, status: l.status as LoanStatus, guarantors: [...l.guarantors], pledges: [...l.pledges],
      approvedBy: Object.fromEntries(addrs.map((a, i) => [a, flags[i]])),
    }
  }))

  const payouts = await Promise.all(index.payoutIds.map(async (s): Promise<PayoutView> => {
    const pid = BigInt(s)
    const po = await read<{ proposer: Address, recipient: Address, amount: bigint, expiresAt: bigint, approvals: number, treasurerApproved: boolean, adminApproved: boolean, executed: boolean, reason: string }>('payout', [pid])
    const flags = await Promise.all(addrs.map(a => read<boolean>('payoutApprovedBy', [pid, a])))
    return {
      id: pid, proposer: po.proposer, recipient: po.recipient, amount: po.amount, expiresAt: po.expiresAt, approvals: po.approvals,
      treasurerApproved: po.treasurerApproved, adminApproved: po.adminApproved, executed: po.executed, reason: po.reason,
      approvedBy: Object.fromEntries(addrs.map((a, i) => [a, flags[i]])),
    }
  }))

  const mandates = config.vault ? await Promise.all(index.mandateIds.map(async (s): Promise<GroupMandate> => {
    const mid = BigInt(s)
    const m = await r.readContract({ address: config.vault!, abi: vaultAbi, functionName: 'mandates', args: [mid] }) as readonly [Address, bigint, bigint, number, number, bigint, bigint, boolean, boolean, bigint]
    const active = !m[8] && m[4] < m[3] && m[5] >= now
    return { id: mid, owner: m[0], amountPerRun: m[1], runs: m[4], maxRuns: m[3], expiry: m[5], revoked: m[8], active }
  })) : []

  return {
    id, p, creator, startAt, memberCount, activeLoans, cash, socialFund, outstanding, totalShares, shareOutStarted,
    now, skew, meeting, totalMeetings, nextMeetingAt: startAt + (meeting + 1n) * p.meetingInterval,
    members, me: members.find(m => same(m.address, me)) ?? null,
    shareValue: valueOf({ totalShares, cash, outstanding, p }, 1n),
    loans: loans.sort((a, b) => Number(b.id - a.id)),
    payouts: payouts.sort((a, b) => Number(b.id - a.id)),
    profile: { name: profile.name, purpose: profile.purpose, coverId: Number(profile.coverId) },
    admin,
    treasurers: members.filter(m => m.role === Role.Treasurer).map(m => m.address),
    mandates,
    relays: index.relays,
    autosaveWindows: index.autosaveWindows,
    approvers: index.approvers,
  }
}

export function useGroup(id: bigint | null, me: Address | null) {
  return useQuery({
    queryKey: ['group', id?.toString(), me],
    queryFn: () => loadGroup(id!, me),
    enabled: id !== null && contractsDeployed(),
    refetchInterval: 30_000,
    retry: 1,
  })
}

export function useGroupFeed(id: bigint | null) {
  return useQuery({
    queryKey: ['groupFeed', id?.toString()],
    queryFn: () => relayer.groupFeed(id!),
    enabled: id !== null && contractsDeployed(),
    refetchInterval: 20_000,
    retry: 1,
  })
}

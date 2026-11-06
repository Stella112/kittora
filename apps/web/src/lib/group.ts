// Live reads for one Group Kitty. Loan / grant ids come from the relayer index; every value is read from the contract
// (multicall-batched by the reader client).
import { useQuery } from '@tanstack/react-query'
import type { Abi, Address } from 'viem'
import { GroupKittyAbi } from '@kittora/core'
import { config, contractsDeployed } from '../config.ts'
import { reader } from './evm.ts'
import { relayer } from './relayer.ts'
import { noteChainTime } from './chainActions.ts'
import { store } from './storage.ts'
import { LoanStatus, valueOf, type GroupDetail, type GrantView, type GroupParams, type LoanView, type MemberRow } from './groupMath.ts'

export * from './groupMath.ts'

const abi = GroupKittyAbi as Abi
const ZERO = '0x0000000000000000000000000000000000000000'
/** Meetings shown on the group board (current one included). */
export const BOARD_MEETINGS = 4

export const groupName = (id: bigint) => store.get<string>(`groupName:${id}`) ?? `Group #${id}`
export const setGroupName = (id: bigint, name: string) => { if (name.trim()) store.set(`groupName:${id}`, name.trim().slice(0, 40)) }

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
export const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase())

export async function loadGroup(id: bigint, me: Address | null): Promise<GroupDetail | null> {
  const r = reader()
  const gk = config.groupKitty!
  const read = <T>(functionName: string, args: unknown[] = []) => r.readContract({ address: gk, abi, functionName, args }) as Promise<T>

  const [p, st, list, index, block] = await Promise.all([
    read<GroupParams>('groupParams', [id]),
    read<readonly [Address, bigint, number, number, bigint, bigint, bigint, bigint, boolean]>('groupState', [id]),
    read<Address[]>('memberList', [id]),
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
    const [m, history, socialPaidNow] = await Promise.all([
      read<readonly [boolean, boolean, bigint, bigint, bigint]>('members', [id, a]),
      Promise.all(meetings.map(i => read<bigint>('sharesInMeeting', [id, a, i]))),
      read<boolean>('socialPaid', [id, a, meeting]),
    ])
    return { address: a, claimed: m[1], shares: m[2], pledged: m[3], activeLoan: m[4], history, socialPaidNow }
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

  const grants = await Promise.all(index.grantIds.map(async (s): Promise<GrantView> => {
    const gid = BigInt(s)
    const g = await read<readonly [Address, bigint, bigint, number, boolean]>('grants', [gid])
    const flags = await Promise.all(addrs.map(a => read<boolean>('grantApprovedBy', [gid, a])))
    return { id: gid, member: g[0], amount: g[2], approvals: g[3], paid: g[4], approvedBy: Object.fromEntries(addrs.map((a, i) => [a, flags[i]])) }
  }))

  return {
    id, p, creator, startAt, memberCount, activeLoans, cash, socialFund, outstanding, totalShares, shareOutStarted,
    now, skew, meeting, totalMeetings, nextMeetingAt: startAt + (meeting + 1n) * p.meetingInterval,
    members, me: members.find(m => same(m.address, me)) ?? null,
    shareValue: valueOf({ totalShares, cash, outstanding, p }, 1n),
    loans: loans.sort((a, b) => Number(b.id - a.id)),
    grants: grants.sort((a, b) => Number(b.id - a.id)),
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

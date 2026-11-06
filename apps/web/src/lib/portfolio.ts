// Live reads for Home. IDs come from the relayer index; every value is read from the contracts.
import { useQuery } from '@tanstack/react-query'
import type { Abi, Address } from 'viem'
import { PocketVaultAbi, GroupKittyAbi } from '@kittora/core'
import { config, contractsDeployed } from '../config.ts'
import { reader } from './evm.ts'
import { relayer } from './relayer.ts'

const vaultAbi = PocketVaultAbi as Abi
const gkAbi = GroupKittyAbi as Abi

export interface PocketView { id: bigint, kind: number, unlockAt: bigint, target: bigint, assets: bigint }
export interface GroupView {
  id: bigint
  shares: bigint
  value: bigint
  nextMeetingAt: bigint
  cycleEnd: bigint
  shareOutOpen: boolean
}
export interface Portfolio { pockets: PocketView[], groups: GroupView[], myKittyTotal: bigint, groupTotal: bigint, nextEvent: { label: string, at: bigint } | null }

export async function loadPortfolio(evm: Address): Promise<Portfolio> {
  const ids = await relayer.me(evm)
  const r = reader()
  const vault = config.vault!
  const gk = config.groupKitty!
  const pockets = await Promise.all(ids.pocketIds.map(async (s) => {
    const id = BigInt(s)
    const [p, assets] = await Promise.all([
      r.readContract({ address: vault, abi: vaultAbi, functionName: 'pockets', args: [id] }) as Promise<readonly [Address, number, bigint, bigint, bigint]>,
      r.readContract({ address: vault, abi: vaultAbi, functionName: 'pocketAssets', args: [id] }) as Promise<bigint>,
    ])
    return { id, kind: p[1], unlockAt: p[2], target: p[3], assets }
  }))
  const now = BigInt(Math.floor(Date.now() / 1000))
  const groups = await Promise.all(ids.groupIds.map(async (s) => {
    const id = BigInt(s)
    const [m, params, state] = await Promise.all([
      r.readContract({ address: gk, abi: gkAbi, functionName: 'members', args: [id, evm] }) as Promise<readonly [boolean, boolean, bigint, bigint, bigint]>,
      r.readContract({ address: gk, abi: gkAbi, functionName: 'groupParams', args: [id] }) as Promise<{ meetingInterval: bigint, cycleEnd: bigint }>,
      r.readContract({ address: gk, abi: gkAbi, functionName: 'groupState', args: [id] }) as Promise<readonly [Address, bigint, number, number, bigint, bigint, bigint, bigint, boolean]>,
    ])
    const value = await r.readContract({ address: gk, abi: gkAbi, functionName: 'valueOfShares', args: [id, m[2]] }) as bigint
    const startAt = state[1]
    const interval = params.meetingInterval
    const idx = now > startAt ? (now - startAt) / interval : 0n
    return { id, shares: m[2], value, nextMeetingAt: startAt + (idx + 1n) * interval, cycleEnd: params.cycleEnd, shareOutOpen: now >= params.cycleEnd }
  }))
  const myKittyTotal = pockets.filter(p => p.kind !== 3).reduce((a, p) => a + p.assets, 0n)
  const groupTotal = groups.reduce((a, g) => a + g.value, 0n)
  const upcoming = groups.flatMap(g => g.shareOutOpen ? [] : [
    { label: 'Next meeting', at: g.nextMeetingAt < g.cycleEnd ? g.nextMeetingAt : g.cycleEnd },
    { label: 'Share-Out', at: g.cycleEnd },
  ]).sort((a, b) => Number(a.at - b.at))
  return { pockets, groups, myKittyTotal, groupTotal, nextEvent: upcoming[0] ?? null }
}

export function usePortfolio(evm: Address | null) {
  return useQuery({
    queryKey: ['portfolio', evm],
    queryFn: () => loadPortfolio(evm!),
    enabled: Boolean(evm) && contractsDeployed(),
    refetchInterval: 30_000,
    retry: 1,
  })
}

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
  name: string
  purpose: string
  coverId: number
}
export interface BondView { id: bigint, pocketId: bigint, nimiqAddress: `0x${string}`, unlockAt: bigint, nimLuna: bigint, groupId: bigint, status: number, assets: bigint }
export interface MandateView { id: bigint, amountPerRun: bigint, interval: bigint, maxRuns: number, runs: number, expiry: bigint, lastRun: bigint, toGroup: boolean, revoked: boolean, destId: bigint }
export interface Portfolio {
  pockets: PocketView[], groups: GroupView[], bonds: BondView[], mandates: MandateView[], myKittyTotal: bigint, groupTotal: bigint, nextEvent: { label: string, at: bigint } | null
  /** Everything in the vault (pockets + bonds), what you put in (on-chain principalOf), and the difference: interest earned. */
  vaultTotal: bigint, principal: bigint, earned: bigint, loadedAt: number
}

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
    const [m, params, state, prof] = await Promise.all([
      r.readContract({ address: gk, abi: gkAbi, functionName: 'members', args: [id, evm] }) as Promise<readonly [boolean, boolean, bigint, bigint, bigint]>,
      r.readContract({ address: gk, abi: gkAbi, functionName: 'groupParams', args: [id] }) as Promise<{ meetingInterval: bigint, cycleEnd: bigint }>,
      r.readContract({ address: gk, abi: gkAbi, functionName: 'groupState', args: [id] }) as Promise<readonly [Address, bigint, number, number, bigint, bigint, bigint, bigint, boolean]>,
      r.readContract({ address: gk, abi: gkAbi, functionName: 'profile', args: [id] }) as Promise<{ name: string, purpose: string, coverId: number }>,
    ])
    const value = await r.readContract({ address: gk, abi: gkAbi, functionName: 'valueOfShares', args: [id, m[2]] }) as bigint
    const startAt = state[1]
    const interval = params.meetingInterval
    const idx = now > startAt ? (now - startAt) / interval : 0n
    return { id, shares: m[2], value, nextMeetingAt: startAt + (idx + 1n) * interval, cycleEnd: params.cycleEnd, shareOutOpen: now >= params.cycleEnd, name: prof.name || `Group #${id}`, purpose: prof.purpose, coverId: Number(prof.coverId) }
  }))
  const bonds = await Promise.all(ids.bondIds.map(async (s) => {
    const id = BigInt(s)
    const b = await r.readContract({ address: vault, abi: vaultAbi, functionName: 'bonds', args: [id] }) as readonly [bigint, Address, `0x${string}`, bigint, bigint, bigint, `0x${string}`, number]
    const assets = await r.readContract({ address: vault, abi: vaultAbi, functionName: 'pocketAssets', args: [b[0]] }) as bigint
    return { id, pocketId: b[0], nimiqAddress: b[2], unlockAt: b[3], nimLuna: b[4], groupId: b[5], status: b[7], assets }
  }))
  const mandates = await Promise.all(ids.mandateIds.map(async (s) => {
    const id = BigInt(s)
    const m = await r.readContract({ address: vault, abi: vaultAbi, functionName: 'mandates', args: [id] }) as readonly [Address, bigint, bigint, number, number, bigint, bigint, boolean, boolean, bigint]
    return { id, amountPerRun: m[1], interval: m[2], maxRuns: m[3], runs: m[4], expiry: m[5], lastRun: m[6], toGroup: m[7], revoked: m[8], destId: m[9] }
  }))
  const myKittyTotal = pockets.filter(p => p.kind !== 3).reduce((a, p) => a + p.assets, 0n)
  const vaultTotal = pockets.reduce((a, p) => a + p.assets, 0n)
  const principal = await r.readContract({ address: vault, abi: vaultAbi, functionName: 'principalOf', args: [evm] }) as bigint
  const earned = vaultTotal > principal ? vaultTotal - principal : 0n
  const groupTotal = groups.reduce((a, g) => a + g.value, 0n)
  const upcoming = groups.flatMap(g => g.shareOutOpen ? [] : [
    { label: 'Next meeting', at: g.nextMeetingAt < g.cycleEnd ? g.nextMeetingAt : g.cycleEnd },
    { label: 'Share-Out', at: g.cycleEnd },
  ]).sort((a, b) => Number(a.at - b.at))
  return { pockets, groups, bonds, mandates, myKittyTotal, groupTotal, nextEvent: upcoming[0] ?? null, vaultTotal, principal, earned, loadedAt: Date.now() }
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

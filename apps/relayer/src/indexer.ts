// Read-side cache (display only; balances are always read live from the contracts).
// Incrementally scans every PocketVault / GroupKitty log from DEPLOY_BLOCK in chunks small enough for free RPC plans,
// and answers:
//   - which pockets / groups / bonds / mandates an address has
//   - which loans / social fund payments / Autosave mandates a group has (the contract has no per-group enumeration)
//   - who approved each loan and payment
//   - an address's on-chain activity feed, for the Activity tab
//   - a group's feed (A1.2): every group event with its initiator, rebuilt from chain data on every start
import { parseEventLogs, type Abi, type Address, type Hex, type PublicClient } from 'viem'
import { PocketVaultAbi, GroupKittyAbi } from '@kittora/core'

const MIN_CHUNK = 10n
/** Providers cap eth_getLogs ranges (drpc free ≈ 100 blocks despite its "10000" message, 1rpc 50): shrink on rejection. */
const RANGE_ERROR = /range|limit|too many|exceed|block/i
const FEED_LIMIT = 100

export interface FeedItem {
  contract: 'vault' | 'group'
  event: string
  args: Record<string, unknown>
  hash: Hex
  block: bigint
  logIndex: number
  ts?: number
}

/** A group feed row. `actor` = initiator ("autosave" when the vault paid; absent for permissionless calls). */
export interface GroupFeedItem extends FeedItem {
  groupId: string
  actor?: string
  ref?: string // loanId / payoutId / mandateId
}

type Log = { eventName: string, args: Record<string, any>, transactionHash: Hex, blockNumber: bigint, logIndex: number }

export class Indexer {
  private scanned: bigint
  private pockets = new Map<string, bigint[]>()
  private groups = new Map<string, bigint[]>()
  private bonds = new Map<string, bigint[]>()
  private mandates = new Map<string, bigint[]>()
  private groupLoans = new Map<string, bigint[]>()
  private groupPayouts = new Map<string, bigint[]>()
  private groupMandates = new Map<string, bigint[]>()
  private feed = new Map<string, FeedItem[]>()
  private groupFeeds = new Map<string, GroupFeedItem[]>()
  private loanGroup = new Map<string, string>()
  private payoutGroup = new Map<string, string>()
  private payoutParties = new Map<string, string[]>() // [proposer, recipient]
  private mandateGroup = new Map<string, string>()
  private loanApprovers = new Map<string, string[]>()
  private payoutApprovers = new Map<string, string[]>()
  private adminOf = new Map<string, string>()
  // id → owner lookups for events that only carry an id
  private mandateOwner = new Map<string, string>()
  private bondOwner = new Map<string, string>()
  private loanParties = new Map<string, string[]>() // [borrower, ...guarantors]
  private blockTs = new Map<bigint, number>()
  private running: Promise<void> | null = null
  /** Current eth_getLogs block span; starts large and only ever shrinks. */
  chunk: bigint
  private waitMs: number
  private pub: PublicClient
  private vault: Address
  private group: Address

  constructor(pub: PublicClient, vault: Address, group: Address, deployBlock: bigint, chunk = 9_000n, waitMs = 5_000) {
    this.chunk = chunk
    this.waitMs = waitMs
    this.pub = pub
    this.vault = vault
    this.group = group
    this.scanned = deployBlock - 1n
  }

  sync(): Promise<void> {
    if (!this.running) {
      this.running = this.doSync().finally(() => { this.running = null })
      this.running.catch(() => undefined) // a caller may stop waiting (fresh); never leave the rejection unhandled
    }
    return this.running
  }

  /**
   * Sync, but wait at most `budgetMs`: a long catch-up on a slow RPC (free plans cap eth_getLogs at ~100 blocks)
   * keeps running in the background and the caller gets what is indexed so far (`scannedTo` says how far).
   * An RPC failure inside the budget still throws.
   */
  async fresh(budgetMs = this.waitMs): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    const budget = new Promise<void>(res => { timer = setTimeout(res, budgetMs) })
    try {
      await Promise.race([this.sync(), budget])
    } finally {
      clearTimeout(timer)
    }
  }

  private add(map: Map<string, bigint[]>, who: string, id: bigint) {
    const k = who.toLowerCase()
    const list = map.get(k) ?? []
    if (!list.includes(id)) list.push(id)
    map.set(k, list)
  }

  private push(contract: FeedItem['contract'], l: Log, who: (string | undefined)[]) {
    const item: FeedItem = { contract, event: l.eventName, args: l.args, hash: l.transactionHash, block: l.blockNumber, logIndex: l.logIndex }
    for (const w of new Set(who.filter(Boolean).map(a => a!.toLowerCase()))) {
      const list = this.feed.get(w) ?? []
      list.push(item)
      this.feed.set(w, list)
    }
  }

  private pushGroup(groupId: unknown, l: Log, actor?: string, ref?: unknown) {
    if (groupId === undefined || groupId === null) return
    const g = String(groupId)
    const item: GroupFeedItem = {
      contract: 'group', event: l.eventName, args: l.args, hash: l.transactionHash, block: l.blockNumber, logIndex: l.logIndex,
      groupId: g, ...(actor ? { actor: actor.toLowerCase() } : {}), ...(ref !== undefined ? { ref: String(ref) } : {}),
    }
    const list = this.groupFeeds.get(g) ?? []
    list.push(item)
    this.groupFeeds.set(g, list)
  }

  private addTo(map: Map<string, string[]>, key: unknown, who: string) {
    const k = String(key)
    const list = map.get(k) ?? []
    const w = who.toLowerCase()
    if (!list.includes(w)) list.push(w)
    map.set(k, list)
  }

  private async doSync() {
    const head = await this.pub.getBlockNumber()
    while (this.scanned < head) {
      const fromBlock = this.scanned + 1n
      const toBlock = fromBlock + this.chunk - 1n > head ? head : fromBlock + this.chunk - 1n
      // Plain address filters (no topic lists): free RPC plans reject OR-topic filters; we decode locally instead.
      let rawVault, rawGroup
      try {
        [rawVault, rawGroup] = await Promise.all([
          this.pub.getLogs({ address: this.vault, fromBlock, toBlock }),
          this.pub.getLogs({ address: this.group, fromBlock, toBlock }),
        ])
      } catch (e) {
        const span = toBlock - fromBlock + 1n
        if (span > MIN_CHUNK && RANGE_ERROR.test(String((e as Error)?.message ?? e))) {
          this.chunk = span / 2n > MIN_CHUNK ? span / 2n : MIN_CHUNK
          continue // retry the same start block with the smaller span
        }
        throw e
      }
      for (const l of parseEventLogs({ abi: PocketVaultAbi as Abi, logs: rawVault }) as unknown as Log[]) this.onVault(l)
      for (const l of parseEventLogs({ abi: GroupKittyAbi as Abi, logs: rawGroup }) as unknown as Log[]) this.onGroup(l)
      this.scanned = toBlock
    }
  }

  private onVault(l: Log) {
    const a = l.args
    switch (l.eventName) {
      case 'PocketOpened': this.add(this.pockets, a.owner, a.pocketId); return this.push('vault', l, [a.owner])
      case 'Deposited': return this.push('vault', l, [a.owner])
      case 'Withdrawn': return this.push('vault', l, [a.owner])
      case 'MandateCreated':
        this.add(this.mandates, a.owner, a.mandateId)
        this.mandateOwner.set(String(a.mandateId), a.owner)
        if (a.toGroup) {
          this.add(this.groupMandates, String(a.destId), a.mandateId)
          this.mandateGroup.set(String(a.mandateId), String(a.destId))
          this.pushGroup(a.destId, { ...l, eventName: 'GroupMandateCreated' }, a.owner, a.mandateId)
        }
        return this.push('vault', l, [a.owner])
      case 'MandateExecuted': return this.push('vault', l, [this.mandateOwner.get(String(a.mandateId))])
      case 'MandateRevoked': {
        const owner = this.mandateOwner.get(String(a.mandateId))
        const g = this.mandateGroup.get(String(a.mandateId))
        if (g && owner) this.pushGroup(g, { ...l, eventName: 'GroupMandateRevoked' }, owner, a.mandateId)
        return this.push('vault', l, [owner])
      }
      case 'BondLocked':
        this.add(this.bonds, a.owner, a.bondId)
        this.bondOwner.set(String(a.bondId), a.owner)
        return this.push('vault', l, [a.owner])
      case 'BondClaimed':
      case 'BondForfeited': return this.push('vault', l, [this.bondOwner.get(String(a.bondId))])
    }
  }

  private onGroup(l: Log) {
    const a = l.args
    const parties = (id: unknown) => this.loanParties.get(String(id)) ?? []
    const payParties = (id: unknown) => this.payoutParties.get(String(id)) ?? []
    const loanG = (id: unknown) => this.loanGroup.get(String(id))
    const payG = (id: unknown) => this.payoutGroup.get(String(id))
    switch (l.eventName) {
      case 'GroupCreated':
        this.adminOf.set(String(a.groupId), String(a.creator).toLowerCase())
        this.pushGroup(a.groupId, l, a.creator)
        return this.push('group', l, [a.creator])
      case 'GroupProfileUpdated':
        return this.pushGroup(a.groupId, l, this.adminOf.get(String(a.groupId)))
      case 'RoleChanged':
        if (Number(a.newRole) === 3) this.adminOf.set(String(a.groupId), String(a.member).toLowerCase())
        this.pushGroup(a.groupId, l, a.by)
        return this.push('group', l, [a.member, a.by])
      case 'MemberJoined':
        this.add(this.groups, a.member, a.groupId)
        this.pushGroup(a.groupId, l, a.member)
        return this.push('group', l, [a.member])
      case 'MemberRemoved':
        this.pushGroup(a.groupId, l, a.by)
        return this.push('group', l, [a.member])
      case 'SharesBought': {
        const viaAutosave = String(a.payer).toLowerCase() === this.vault.toLowerCase()
        this.pushGroup(a.groupId, l, viaAutosave ? 'autosave' : a.member)
        return this.push('group', l, [a.member])
      }
      case 'ForfeitReceived': return this.pushGroup(a.groupId, l)
      case 'LoanRequested':
        this.add(this.groupLoans, String(a.groupId), a.loanId)
        this.loanGroup.set(String(a.loanId), String(a.groupId))
        this.loanParties.set(String(a.loanId), [a.borrower, ...(a.guarantors as string[])])
        this.pushGroup(a.groupId, l, a.borrower, a.loanId)
        return this.push('group', l, [a.borrower, ...(a.guarantors as string[])])
      case 'LoanApproved':
        this.addTo(this.loanApprovers, a.loanId, a.member)
        this.pushGroup(loanG(a.loanId), l, a.member, a.loanId)
        return this.push('group', l, [a.member, parties(a.loanId)[0]])
      case 'LoanCancelled':
        this.pushGroup(loanG(a.loanId), l, parties(a.loanId)[0], a.loanId)
        return this.push('group', l, parties(a.loanId))
      case 'LoanDisbursed':
      case 'LoanDefaulted':
        this.pushGroup(loanG(a.loanId), l, undefined, a.loanId)
        return this.push('group', l, parties(a.loanId))
      case 'LoanRepaid':
        this.pushGroup(loanG(a.loanId), l, a.payer, a.loanId)
        return this.push('group', l, [a.payer, parties(a.loanId)[0]])
      case 'SocialPayoutProposed':
        this.add(this.groupPayouts, String(a.groupId), a.payoutId)
        this.payoutGroup.set(String(a.payoutId), String(a.groupId))
        this.payoutParties.set(String(a.payoutId), [a.proposer, a.recipient])
        this.pushGroup(a.groupId, l, a.proposer, a.payoutId)
        return this.push('group', l, [a.proposer, a.recipient])
      case 'SocialPayoutApproved':
        this.addTo(this.payoutApprovers, a.payoutId, a.member)
        this.pushGroup(payG(a.payoutId), l, a.member, a.payoutId)
        return this.push('group', l, [a.member, payParties(a.payoutId)[0]])
      case 'SocialPayoutExecuted':
        this.pushGroup(a.groupId, l, undefined, a.payoutId)
        return this.push('group', l, payParties(a.payoutId))
      case 'ShareOutClaimed':
        this.pushGroup(a.groupId, l, a.member)
        return this.push('group', l, [a.member])
    }
  }

  private async withTimes<T extends FeedItem>(items: T[]): Promise<(T & { ts?: number })[]> {
    const missing = [...new Set(items.map(i => i.block).filter(b => !this.blockTs.has(b)))]
    await Promise.all(missing.map(async (b) => {
      const blk = await this.pub.getBlock({ blockNumber: b }).catch(() => null)
      if (blk) this.blockTs.set(b, Number(blk.timestamp))
    }))
    return items.map(i => ({ ...i, ts: this.blockTs.get(i.block) }))
  }

  private newestFirst<T extends FeedItem>(items: T[], limit: number): T[] {
    return [...items].sort((x, y) => (x.block === y.block ? y.logIndex - x.logIndex : Number(y.block - x.block))).slice(0, limit)
  }

  async of(address: string) {
    await this.fresh()
    const k = address.toLowerCase()
    return {
      pocketIds: this.pockets.get(k) ?? [],
      groupIds: this.groups.get(k) ?? [],
      bondIds: this.bonds.get(k) ?? [],
      mandateIds: this.mandates.get(k) ?? [],
      scannedTo: this.scanned,
    }
  }

  async groupIndex(groupId: bigint) {
    await this.fresh()
    const k = String(groupId)
    const loanIds = this.groupLoans.get(k) ?? []
    const payoutIds = this.groupPayouts.get(k) ?? []
    return {
      loanIds,
      payoutIds,
      mandateIds: this.groupMandates.get(k) ?? [],
      approvers: {
        loans: Object.fromEntries(loanIds.map(id => [String(id), this.loanApprovers.get(String(id)) ?? []])),
        payouts: Object.fromEntries(payoutIds.map(id => [String(id), this.payoutApprovers.get(String(id)) ?? []])),
      },
      scannedTo: this.scanned,
    }
  }

  /** Members tab: meetings each member bought shares in, over the whole history (not a feed page), and when they joined. */
  async memberStats(groupId: bigint) {
    await this.fresh()
    const rows = this.groupFeeds.get(String(groupId)) ?? []
    const paid = new Map<string, Set<number>>()
    const joins = new Map<string, FeedItem>()
    for (const r of rows) {
      const m = String(r.args.member ?? '').toLowerCase()
      if (r.event === 'SharesBought') { const s = paid.get(m) ?? new Set<number>(); s.add(Number(r.args.meeting)); paid.set(m, s) }
      if (r.event === 'MemberJoined') { const prev = joins.get(m); if (!prev || prev.block < r.block) joins.set(m, r) } // latest join (after a removal)
    }
    const timed = await this.withTimes([...joins.values()])
    const out: Record<string, { paid: number[], joinedTs: number | null }> = {}
    for (const j of timed) out[String(j.args.member).toLowerCase()] = { paid: [], joinedTs: j.ts ?? null }
    for (const [m, s] of paid) out[m] = { paid: [...s].sort((a, b) => a - b), joinedTs: out[m]?.joinedTs ?? null }
    return out
  }

  /** A1.2: the group's feed, newest first, with block times. Rebuilt from chain logs on every relayer start. */
  async groupFeed(groupId: bigint, limit = 200) {
    await this.fresh()
    const items = this.newestFirst(this.groupFeeds.get(String(groupId)) ?? [], limit)
    return { items: await this.withTimes(items), scannedTo: this.scanned }
  }

  /** Newest first, at most FEED_LIMIT items, each with its block timestamp. */
  async activity(address: string) {
    await this.fresh()
    const items = this.newestFirst(this.feed.get(address.toLowerCase()) ?? [], FEED_LIMIT)
    return { items: await this.withTimes(items), scannedTo: this.scanned }
  }
}

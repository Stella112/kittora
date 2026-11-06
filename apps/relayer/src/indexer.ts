// Read-side cache (display only; balances are always read live from the contracts).
// Incrementally scans every PocketVault / GroupKitty log from DEPLOY_BLOCK in chunks small enough for free RPC plans,
// and answers:
//   - which pockets / groups / bonds / mandates an address has
//   - which loans / grants a group has (the contract has no per-group enumeration)
//   - an address's on-chain activity feed (event name, args, tx hash), for the Activity tab
import { parseEventLogs, type Abi, type Address, type Hex, type PublicClient } from 'viem'
import { PocketVaultAbi, GroupKittyAbi } from '@kittora/core'

const CHUNK = 9_000n
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

type Log = { eventName: string, args: Record<string, any>, transactionHash: Hex, blockNumber: bigint, logIndex: number }

export class Indexer {
  private scanned: bigint
  private pockets = new Map<string, bigint[]>()
  private groups = new Map<string, bigint[]>()
  private bonds = new Map<string, bigint[]>()
  private mandates = new Map<string, bigint[]>()
  private groupLoans = new Map<string, bigint[]>()
  private groupGrants = new Map<string, bigint[]>()
  private feed = new Map<string, FeedItem[]>()
  // id → owner lookups for events that only carry an id
  private mandateOwner = new Map<string, string>()
  private bondOwner = new Map<string, string>()
  private loanParties = new Map<string, string[]>() // [borrower, ...guarantors]
  private grantMember = new Map<string, string>()
  private blockTs = new Map<bigint, number>()
  private running: Promise<void> | null = null
  private pub: PublicClient
  private vault: Address
  private group: Address

  constructor(pub: PublicClient, vault: Address, group: Address, deployBlock: bigint) {
    this.pub = pub
    this.vault = vault
    this.group = group
    this.scanned = deployBlock - 1n
  }

  sync(): Promise<void> {
    this.running ??= this.doSync().finally(() => { this.running = null })
    return this.running
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

  private async doSync() {
    const head = await this.pub.getBlockNumber()
    while (this.scanned < head) {
      const fromBlock = this.scanned + 1n
      const toBlock = fromBlock + CHUNK - 1n > head ? head : fromBlock + CHUNK - 1n
      // Plain address filters (no topic lists): free RPC plans reject OR-topic filters; we decode locally instead.
      const [rawVault, rawGroup] = await Promise.all([
        this.pub.getLogs({ address: this.vault, fromBlock, toBlock }),
        this.pub.getLogs({ address: this.group, fromBlock, toBlock }),
      ])
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
        return this.push('vault', l, [a.owner])
      case 'MandateExecuted':
      case 'MandateRevoked': return this.push('vault', l, [this.mandateOwner.get(String(a.mandateId))])
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
    switch (l.eventName) {
      case 'GroupCreated': return this.push('group', l, [a.creator])
      case 'MemberJoined': this.add(this.groups, a.member, a.groupId); return this.push('group', l, [a.member])
      case 'SharesBought': return this.push('group', l, [a.member])
      case 'LoanRequested':
        this.add(this.groupLoans, String(a.groupId), a.loanId)
        this.loanParties.set(String(a.loanId), [a.borrower, ...(a.guarantors as string[])])
        return this.push('group', l, [a.borrower, ...(a.guarantors as string[])])
      case 'LoanApproved': return this.push('group', l, [a.member, parties(a.loanId)[0]])
      case 'LoanCancelled':
      case 'LoanDisbursed':
      case 'LoanDefaulted': return this.push('group', l, parties(a.loanId))
      case 'LoanRepaid': return this.push('group', l, [a.payer, parties(a.loanId)[0]])
      case 'GrantRequested':
        this.add(this.groupGrants, String(a.groupId), a.grantId)
        this.grantMember.set(String(a.grantId), a.member)
        return this.push('group', l, [a.member])
      case 'GrantApproved': return this.push('group', l, [a.member, this.grantMember.get(String(a.grantId))])
      case 'GrantPaid': return this.push('group', l, [this.grantMember.get(String(a.grantId))])
      case 'ShareOutClaimed': return this.push('group', l, [a.member])
    }
  }

  async of(address: string) {
    await this.sync()
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
    await this.sync()
    const k = String(groupId)
    return { loanIds: this.groupLoans.get(k) ?? [], grantIds: this.groupGrants.get(k) ?? [], scannedTo: this.scanned }
  }

  /** Newest first, at most FEED_LIMIT items, each with its block timestamp. */
  async activity(address: string) {
    await this.sync()
    const items = [...(this.feed.get(address.toLowerCase()) ?? [])]
      .sort((x, y) => (x.block === y.block ? y.logIndex - x.logIndex : Number(y.block - x.block)))
      .slice(0, FEED_LIMIT)
    const missing = [...new Set(items.map(i => i.block).filter(b => !this.blockTs.has(b)))]
    await Promise.all(missing.map(async (b) => {
      const blk = await this.pub.getBlock({ blockNumber: b }).catch(() => null)
      if (blk) this.blockTs.set(b, Number(blk.timestamp))
    }))
    return { items: items.map(i => ({ ...i, ts: this.blockTs.get(i.block) })), scannedTo: this.scanned }
  }
}

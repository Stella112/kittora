// Read-side cache (display only; balances are always read live from the contracts).
// Incrementally scans PocketOpened / MemberJoined / BondLocked / MandateCreated logs from DEPLOY_BLOCK in chunks
// small enough for free RPC plans, and answers "which pockets / groups / bonds / mandates does this address have".
import type { Abi, Address, PublicClient } from 'viem'
import { PocketVaultAbi, GroupKittyAbi } from '@kittora/core'

const CHUNK = 9_000n

export class Indexer {
  private scanned: bigint
  private pockets = new Map<string, bigint[]>()
  private groups = new Map<string, bigint[]>()
  private bonds = new Map<string, bigint[]>()
  private mandates = new Map<string, bigint[]>()
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

  private async doSync() {
    const head = await this.pub.getBlockNumber()
    while (this.scanned < head) {
      const fromBlock = this.scanned + 1n
      const toBlock = fromBlock + CHUNK - 1n > head ? head : fromBlock + CHUNK - 1n
      const [vaultLogs, groupLogs] = await Promise.all([
        this.pub.getContractEvents({ address: this.vault, abi: PocketVaultAbi as Abi, fromBlock, toBlock }),
        this.pub.getContractEvents({ address: this.group, abi: GroupKittyAbi as Abi, eventName: 'MemberJoined', fromBlock, toBlock }),
      ])
      for (const l of vaultLogs as any[]) {
        if (l.eventName === 'PocketOpened') this.add(this.pockets, l.args.owner, l.args.pocketId)
        if (l.eventName === 'BondLocked') this.add(this.bonds, l.args.owner, l.args.bondId)
        if (l.eventName === 'MandateCreated') this.add(this.mandates, l.args.owner, l.args.mandateId)
      }
      for (const l of groupLogs as any[]) this.add(this.groups, l.args.member, l.args.groupId)
      this.scanned = toBlock
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
}

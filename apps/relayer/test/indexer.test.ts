// TEST MOCK RPC: an eth_getLogs provider that rejects spans over 100 blocks (like drpc's free plan).
import { describe, it, expect } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, type Address, type PublicClient } from 'viem'
import { PocketVaultAbi } from '@kittora/core'
import { Indexer } from '../src/indexer.ts'

const VAULT: Address = '0x7B1e1bAed045Db95b5F5b3E1e6E50efdac851251'
const GROUP: Address = '0x2271dA8756185B48A46A17051fF3A90d6481ed5f'
const OWNER: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'

function mockRpc(head: bigint, eventBlock: bigint, maxSpan = 100n) {
  const calls: bigint[] = []
  const log = {
    address: VAULT.toLowerCase(),
    topics: encodeEventTopics({ abi: PocketVaultAbi, eventName: 'PocketOpened', args: { pocketId: 4n, owner: OWNER } }),
    data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint64' }, { type: 'uint256' }], [0, 0n, 0n]),
    blockNumber: eventBlock, transactionHash: `0x${'aa'.repeat(32)}`, logIndex: 0, blockHash: `0x${'bb'.repeat(32)}`, transactionIndex: 0, removed: false,
  }
  const pub = {
    getBlockNumber: async () => head,
    getBlock: async () => ({ timestamp: 1_793_000_000n }),
    getLogs: async ({ address, fromBlock, toBlock }: { address: Address, fromBlock: bigint, toBlock: bigint }) => {
      calls.push(toBlock - fromBlock + 1n)
      if (toBlock - fromBlock + 1n > maxSpan) throw new Error('ranges over 10000 blocks are not supported on free plan')
      return address === VAULT && fromBlock <= eventBlock && eventBlock <= toBlock ? [log] : []
    },
  } as unknown as PublicClient
  return { pub, calls }
}

describe('indexer log ranges', () => {
  it('shrinks the getLogs span when the provider rejects it, and finds the event', async () => {
    const { pub, calls } = mockRpc(1_003_656n, 1_002_000n)
    const ix = new Indexer(pub, VAULT, GROUP, 1_000_000n)
    const me = await ix.of(OWNER)
    expect(me.pocketIds).toEqual([4n])
    expect(me.scannedTo).toBe(1_003_656n)
    expect(ix.chunk).toBeLessThanOrEqual(100n)
    expect(ix.chunk).toBeGreaterThanOrEqual(50n) // halving lands near the limit, not far below it
    const feed = await ix.activity(OWNER)
    expect(feed.items[0]).toMatchObject({ event: 'PocketOpened', ts: 1_793_000_000 })
    expect(calls.filter(s => s > 100n).length).toBeLessThan(20) // a few rejections, then steady
  })

  it('answers within the wait budget during a long catch-up, then keeps syncing in the background', async () => {
    const slow = mockRpc(1_003_656n, 1_000_050n)
    const orig = (slow.pub as any).getLogs
    ;(slow.pub as any).getLogs = async (a: any) => { await new Promise(r => setTimeout(r, 20)); return orig(a) }
    const ix = new Indexer(slow.pub, VAULT, GROUP, 1_000_000n, 9_000n, 300)
    const t0 = Date.now()
    const first = await ix.of(OWNER)
    expect(Date.now() - t0).toBeLessThan(1_500)
    expect(first.scannedTo).toBeLessThan(1_003_656n) // partial, not an error
    await ix.sync() // the same background run finishes
    expect((await ix.of(OWNER)).scannedTo).toBe(1_003_656n)
  })

  it('does not swallow other RPC errors', async () => {
    const pub = { getBlockNumber: async () => 10n, getLogs: async () => { throw new Error('ECONNRESET') } } as unknown as PublicClient
    await expect(new Indexer(pub, VAULT, GROUP, 1n).of(OWNER)).rejects.toThrow('ECONNRESET')
  })
})

describe('member stats use the whole history, not a feed page', () => {
  it('counts 250 paid meetings for one member', async () => {
    const { encodeAbiParameters, encodeEventTopics } = await import('viem')
    const { GroupKittyAbi } = await import('@kittora/core')
    const mk = (eventName: string, args: Record<string, unknown>, data: `0x${string}`, block: bigint, i: number) => ({
      address: GROUP.toLowerCase(), topics: encodeEventTopics({ abi: GroupKittyAbi as any, eventName, args } as any), data,
      blockNumber: block, transactionHash: `0x${i.toString(16).padStart(64, '0')}`, logIndex: 0, blockHash: `0x${'bb'.repeat(32)}`, transactionIndex: 0, removed: false,
    })
    const logs = [mk('MemberJoined', { groupId: 1n, member: OWNER }, '0x', 10n, 1)]
    for (let m = 0; m < 250; m++) {
      logs.push(mk('SharesBought', { groupId: 1n, member: OWNER },
        encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }], [BigInt(m), 1n, 0n, OWNER]), 20n + BigInt(m), 2 + m))
    }
    const pub = {
      getBlockNumber: async () => 300n,
      getBlock: async () => ({ timestamp: 1_793_000_000n }),
      getLogs: async ({ address }: { address: Address }) => (address === GROUP ? logs : []),
    } as unknown as PublicClient
    const ix = new Indexer(pub, VAULT, GROUP, 1n)
    const s = await ix.memberStats(1n)
    expect(s[OWNER.toLowerCase()].paid).toHaveLength(250)
    expect(s[OWNER.toLowerCase()].joinedTs).toBe(1_793_000_000)
    expect((await ix.groupFeed(1n)).items).toHaveLength(200) // the feed page stays capped; stats do not
  })
})

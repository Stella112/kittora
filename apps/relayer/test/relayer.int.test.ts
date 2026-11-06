// Gate 2 integration tests: relayer policy, gasless flow, nonce queue, scheduler idempotency, watcher + attester.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { KeyPair } from '@nimiq/core'
import { vaultTyped, groupTyped, usdtMetaTxTyped, linkMessage, linkHash, PocketVaultAbi } from '@kittora/core'
import { startFork, fundUsdt, ANVIL_KEYS, USDT } from './fork.ts'
import { build } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { schedulerTick } from '../src/scheduler.ts'
import { watcherTick } from '../src/watcher.ts'
import { nimiqMessageHash, nimiqToBytes20, NimiqRpc } from '../src/nimiq.ts'
import { openDb } from '../src/db.ts'
import pino from 'pino'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 8549
let f: Awaited<ReturnType<typeof startFork>>
let r: ReturnType<typeof build>
const users: PrivateKeyAccount[] = []
const dir = mkdtempSync(join(tmpdir(), 'kittora-relayer-'))
const DL = () => String(Math.floor(Date.now() / 1000) + 3600)

function cfg(over: Record<string, string> = {}) {
  return loadConfig({
    POLYGON_RPC_URL: f.url, CHAIN_ID: '137', RELAYER_PRIVATE_KEY: ANVIL_KEYS.relayer, ATTESTER_PRIVATE_KEY: ANVIL_KEYS.attester,
    VAULT_ADDRESS: f.vault, GROUP_KITTY_ADDRESS: f.group, DB_PATH: join(dir, `db-${Math.random()}.sqlite`), LOG_LEVEL: 'silent', ...over,
  })
}

async function post(app: ReturnType<typeof build>['app'], body: unknown) {
  const res = await app.request('/relay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() as any }
}

const nonceOf = async (target: Address, who: Address) => f.pub.readContract({ address: target, abi: PocketVaultAbi, functionName: 'nonces', args: [who] }) as Promise<bigint>
const usdtNonce = (who: Address) => f.pub.readContract({ address: USDT, abi: parseAbi(['function getNonce(address) view returns (uint256)']), functionName: 'getNonce', args: [who] })
const usdtBal = (who: Address) => f.pub.readContract({ address: USDT, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [who] })
const wait = (hash: Hex) => f.pub.waitForTransactionReceipt({ hash })

async function signVault(u: PrivateKeyAccount, primary: any, message: Record<string, unknown>) {
  const td = vaultTyped(f.vault, primary, message)
  return u.signTypedData(td as any)
}
async function signGroup(u: PrivateKeyAccount, primary: any, message: Record<string, unknown>) {
  return u.signTypedData(groupTyped(f.group, primary, message) as any)
}

async function gaslessApprove(u: PrivateKeyAccount, spender: Address, amount: bigint) {
  const nonce = await usdtNonce(u.address)
  const fnSig = encodeFunctionData({ abi: parseAbi(['function approve(address,uint256)']), functionName: 'approve', args: [spender, amount] })
  const signature = await u.signTypedData(usdtMetaTxTyped('USDT0', u.address, nonce, fnSig) as any)
  return post(r.app, { action: 'usdt.approve', params: { owner: u.address, spender, amount: String(amount), nonce: String(nonce) }, signature })
}

async function deposit(u: PrivateKeyAccount, pocketId: bigint, amount: bigint) {
  const n = await nonceOf(f.vault, u.address)
  const params = { owner: u.address, pocketId: String(pocketId), amount: String(amount), nonce: String(n), deadline: DL() }
  const signature = await signVault(u, 'Deposit', { ...params, pocketId, amount, nonce: n, deadline: BigInt(params.deadline) })
  return { params, signature }
}

async function openFlex(u: PrivateKeyAccount, amount: bigint) {
  const n = await nonceOf(f.vault, u.address)
  const msg = { owner: u.address, kind: 0, unlockAt: 0n, target: 0n, amount, nonce: n, deadline: BigInt(DL()) }
  const signature = await signVault(u, 'OpenPocket', msg)
  const res = await post(r.app, { action: 'vault.openPocket', params: { ...msg, unlockAt: '0', target: '0', amount: String(amount), nonce: String(n), deadline: String(msg.deadline) }, signature })
  expect(res.body.error).toBeUndefined()
  await wait(res.body.hash)
  return f.pub.readContract({ address: f.vault, abi: PocketVaultAbi, functionName: 'pocketCount' }) as Promise<bigint>
}

beforeAll(async () => {
  f = await startFork(PORT)
  r = build(cfg())
  for (let i = 0; i < 5; i++) {
    const u = privateKeyToAccount(generatePrivateKey())
    users.push(u)
    await fundUsdt(f, u.address, 50_000_000n)
  }
}, 300_000)

afterAll(() => {
  r?.stop()
  f?.proc.kill()
})

describe('gasless happy path (user holds zero POL)', () => {
  it('meta-tx approve, then open + deposit, submitted by the relayer', async () => {
    const u = users[0]
    expect(await f.pub.getBalance({ address: u.address })).toBe(0n)
    const a = await gaslessApprove(u, f.vault, 100_000_000n)
    expect(a.status).toBe(200)
    const rcpt = await wait(a.body.hash)
    expect(rcpt.from.toLowerCase()).toBe(r.sender.account.address.toLowerCase())
    const before = await usdtBal(u.address)
    const id = await openFlex(u, 5_000_000n)
    expect(id).toBe(1n)
    expect(before - (await usdtBal(u.address))).toBe(5_000_000n)
    expect(await f.pub.getBalance({ address: u.address })).toBe(0n)
    const st = await r.app.request(`/status/${a.body.hash}`)
    expect((await st.json() as any).status).toBe('confirmed')
  })
})

describe('relayer rejections (Gate 2)', () => {
  it('rejects unknown actions / functions', async () => {
    const res = await post(r.app, { action: 'vault.setGroupKitty', params: {}, signature: '0x' })
    expect(res.body.error).toBe('unknown_action')
    const res2 = await post(r.app, { action: 'usdt.transfer', params: {} })
    expect(res2.body.error).toBe('unknown_action')
  })

  it('rejects extra / malformed params', async () => {
    const res = await post(r.app, { action: 'group.disburse', params: { loanId: '1', to: '0x0' } })
    expect(res.body.error).toBe('bad_params')
  })

  it('rejects forged signatures', async () => {
    const [u, mallory] = [users[0], users[1]]
    const n = await nonceOf(f.vault, u.address)
    const params = { owner: u.address, pocketId: '1', amount: '1000000', nonce: String(n), deadline: DL() }
    const signature = await signVault(mallory, 'Deposit', { ...params, pocketId: 1n, amount: 1_000_000n, nonce: n, deadline: BigInt(params.deadline) })
    const res = await post(r.app, { action: 'vault.deposit', params, signature })
    expect(res.body.error).toBe('bad_signature')
  })

  it('rejects expired requests', async () => {
    const u = users[0]
    const n = await nonceOf(f.vault, u.address)
    const params = { owner: u.address, pocketId: '1', amount: '1000000', nonce: String(n), deadline: '1000' }
    const signature = await signVault(u, 'Deposit', { ...params, pocketId: 1n, amount: 1_000_000n, nonce: n, deadline: 1000n })
    expect((await post(r.app, { action: 'vault.deposit', params, signature })).body.error).toBe('expired')
  })

  it('rejects replayed signatures', async () => {
    const { params, signature } = await deposit(users[0], 1n, 1_000_000n)
    const ok = await post(r.app, { action: 'vault.deposit', params, signature })
    expect(ok.status).toBe(200)
    await wait(ok.body.hash)
    const again = await post(r.app, { action: 'vault.deposit', params, signature })
    expect(again.body.error).toBe('replayed')
  })

  it('rejects USDT approvals to a foreign spender', async () => {
    const res = await gaslessApprove(users[1], '0x000000000000000000000000000000000000dEaD', 1n)
    expect(res.body.error).toBe('bad_spender')
  })

  it('rejects calls that would revert (simulation)', async () => {
    const res = await post(r.app, { action: 'group.disburse', params: { loanId: '99' } })
    expect(res.body.error).toBe('simulation_failed')
    expect(res.body.message).toMatch(/BadLoanState/)
  })

  it('rejects gas above the cap', async () => {
    const low = build(cfg({ GAS_CAP: '50000', RELAYER_PRIVATE_KEY: ANVIL_KEYS.relayer2 }))
    const { params, signature } = await deposit(users[0], 1n, 1_000_000n)
    const res = await post(low.app, { action: 'vault.deposit', params, signature })
    expect(res.body.error).toBe('gas_cap')
    low.stop()
  })

  it('rate-limits per address per hour', async () => {
    const lim = build(cfg({ RATE_LIMIT_PER_HOUR: '2', RELAYER_PRIVATE_KEY: ANVIL_KEYS.relayer2 }))
    const u = users[2]
    await wait((await gaslessApprove(u, f.vault, 100_000_000n)).body.hash)
    const id = await openFlex(u, 1_000_000n)
    for (let i = 0; i < 2; i++) {
      const { params, signature } = await deposit(u, id, 1_000_000n)
      const res = await post(lim.app, { action: 'vault.deposit', params, signature })
      expect(res.status).toBe(200)
      await wait(res.body.hash)
    }
    const { params, signature } = await deposit(u, id, 1_000_000n)
    const res = await post(lim.app, { action: 'vault.deposit', params, signature })
    expect(res.status).toBe(429)
    expect(res.body.error).toBe('rate_limited')
    lim.stop()
  })
})

describe('nonce queue under concurrency', () => {
  it('sends 5 concurrent relays with distinct nonces, all confirmed', async () => {
    const creator = users[3]
    await wait((await gaslessApprove(creator, f.group, 100_000_000n)).body.hash)
    const n = await nonceOf(f.group, creator.address)
    const now = BigInt(Math.floor(Date.now() / 1000))
    const msg = {
      creator: creator.address, sharePrice: 1_000_000n, socialFundPerMeeting: 200_000n, meetingInterval: 86_400n, cycleEnd: now + 30n * 86_400n,
      gracePeriod: 172_800n, interestBps: 1000, maxLoanMultipleBps: 30000, maxSharesPerMeeting: 5, approvalsRequired: 2, maxMembers: 10, nonce: n, deadline: BigInt(DL()),
    }
    const sig = await signGroup(creator, 'CreateGroup', msg)
    const params = Object.fromEntries(Object.entries(msg).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v]))
    const c = await post(r.app, { action: 'group.createGroup', params, signature: sig })
    expect(c.body.error).toBeUndefined()
    await wait(c.body.hash)
    const joiners = [users[0], users[1], users[2], users[4]]
    const reqs = await Promise.all(joiners.map(async (u) => {
      const jn = await nonceOf(f.group, u.address)
      const m = { member: u.address, groupId: 1n, nonce: jn, deadline: BigInt(DL()) }
      return { action: 'group.join', params: { member: u.address, groupId: '1', nonce: String(jn), deadline: String(m.deadline) }, signature: await signGroup(u, 'JoinGroup', m) }
    }))
    const res = await Promise.all(reqs.map(b => post(r.app, b)))
    for (const x of res) expect(x.body.error).toBeUndefined()
    const rcpts = await Promise.all(res.map(x => wait(x.body.hash)))
    for (const rc of rcpts) expect(rc.status).toBe('success')
    const nonces = await Promise.all(res.map(async x => (await f.pub.getTransaction({ hash: x.body.hash })).nonce))
    expect(new Set(nonces).size).toBe(5 - 1)
  })
})

describe('scheduler (Autosave) runs exactly once per run, survives restart', () => {
  it('runs, does not double-send, restarts cleanly, runs again after interval, stops on revoke', async () => {
    const u = users[0] // has approval to vault + pocket 1
    const n = await nonceOf(f.vault, u.address)
    const block = await f.pub.getBlock()
    const msg = { owner: u.address, amountPerRun: 1_000_000n, interval: 3600n, maxRuns: 3, expiry: block.timestamp + 86_400n, toGroup: false, destId: 1n, nonce: n, deadline: BigInt(DL()) }
    const sig = await signVault(u, 'CreateMandate', msg)
    const params = Object.fromEntries(Object.entries(msg).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v]))
    const c = await post(r.app, { action: 'vault.createMandate', params, signature: sig })
    expect(c.body.error).toBeUndefined()
    await wait(c.body.hash)

    const dbPath = join(dir, 'sched.sqlite')
    const log = pino({ level: 'silent' })
    const chainNow = async () => Number((await f.pub.getBlock()).timestamp) * 1000
    let db = openDb(dbPath)
    const deps = async () => ({ pub: f.pub as any, sender: r.sender, db: db.db, log, vault: f.vault, usdt: USDT, now: () => 0 })
    const tick = async () => { const d = await deps(); const t = await chainNow(); return schedulerTick({ ...d, now: () => t }) }

    const t1 = await tick()
    expect(t1.sent).toBe(1)
    const t1b = await tick() // pending or confirmed: must not resend run 1
    expect(t1b.sent).toBe(0)
    // restart: new DB handle, same file
    db.close()
    db = openDb(dbPath)
    await new Promise(res => setTimeout(res, 1500))
    const t2 = await tick()
    expect(t2.sent).toBe(0)
    const m1 = await f.pub.readContract({ address: f.vault, abi: PocketVaultAbi, functionName: 'mandates', args: [1n] }) as readonly any[]
    expect(m1[4]).toBe(1) // runs

    await f.test.increaseTime({ seconds: 3601 })
    await f.test.mine({ blocks: 1 })
    const t3 = await tick()
    expect(t3.sent).toBe(1)
    await new Promise(res => setTimeout(res, 1500))
    const m2 = await f.pub.readContract({ address: f.vault, abi: PocketVaultAbi, functionName: 'mandates', args: [1n] }) as readonly any[]
    expect(m2[4]).toBe(2)

    // revoke stops it
    const rn = await nonceOf(f.vault, u.address)
    const rmsg = { owner: u.address, mandateId: 1n, nonce: rn, deadline: BigInt(DL()) }
    const rv = await post(r.app, { action: 'vault.revokeMandate', params: { owner: u.address, mandateId: '1', nonce: String(rn), deadline: String(rmsg.deadline) }, signature: await signVault(u, 'RevokeMandate', rmsg) })
    await wait(rv.body.hash)
    await f.test.increaseTime({ seconds: 3601 })
    await f.test.mine({ blocks: 1 })
    expect((await tick()).sent).toBe(0)
    db.close()
  })
})

/** TEST MOCK: Nimiq RPC with a controllable active stake (the live-testnet run is a device step; see SPIKE.md). */
class MockNimiq extends NimiqRpc {
  stake = 0
  constructor() { super('http://unused') }
  override async activeStake() { return { active: this.stake, found: this.stake > 0 } }
  override async latestTxs() { return [{ hash: 'ab'.repeat(32), blockNumber: 1, recipientData: '', senderData: '', to: '', from: '' }] }
}

describe('NIM SafeLock: relayer link checks, watcher + attester forfeit', () => {
  it('locks a bond with a verified Nimiq link, then forfeits on early unstake with the tx hash', async () => {
    const u = users[1]
    await wait((await gaslessApprove(u, f.vault, 100_000_000n)).body.hash)
    const kp = KeyPair.generate()
    const nimAddr = kp.toAddress().toUserFriendlyAddress()
    const mock = new MockNimiq()
    r.deps.nimiq = mock
    const n = await nonceOf(f.vault, u.address)
    const block = await f.pub.getBlock()
    const unlockAt = block.timestamp + 7n * 86_400n
    const nimLuna = 100_00000n
    const message = linkMessage({ nimiqAddress: nimAddr, evmAddress: u.address, lockNonce: n, chainId: 137, vault: f.vault, nimLuna, unlockAt })
    const nsig = kp.sign(nimiqMessageHash(message))
    const link = { nimiqAddress: nimAddr, publicKey: kp.publicKey.toHex(), signature: nsig.toHex() }
    const lh = linkHash(message, link.publicKey, link.signature)
    const msg = { owner: u.address, amount: 5_000_000n, unlockAt, nimiqAddress: nimiqToBytes20(nimAddr), nimLuna, groupId: 0n, linkHash: lh, nonce: n, deadline: BigInt(DL()) }
    const sig = await signVault(u, 'LockBond', msg)
    const params = Object.fromEntries(Object.entries(msg).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v]))

    mock.stake = 0
    expect((await post(r.app, { action: 'vault.lockBond', params, signature: sig, nimiqLink: link })).body.error).toBe('stake_missing')
    expect((await post(r.app, { action: 'vault.lockBond', params, signature: sig, nimiqLink: { ...link, signature: '00'.repeat(64) } })).body.error).toBe('bad_link')

    mock.stake = 200_00000
    const ok = await post(r.app, { action: 'vault.lockBond', params, signature: sig, nimiqLink: link })
    expect(ok.body.error).toBeUndefined()
    await wait(ok.body.hash)

    const db = openDb(join(dir, 'watch.sqlite'))
    const log = pino({ level: 'silent' })
    const now = Number(unlockAt - 86_400n) * 1000
    const w = () => watcherTick({ pub: f.pub as any, attester: r.attester!, db: db.db, log, nimiq: mock, vault: f.vault, now: () => now })
    expect((await w()).forfeited).toBe(0) // stake intact

    mock.stake = 50_00000 // dropped below the bond
    const burnBefore = await usdtBal('0x000000000000000000000000000000000000dEaD')
    const res = await w()
    expect(res.forfeited).toBe(1)
    await new Promise(res => setTimeout(res, 1500))
    const logs = await f.pub.getContractEvents({ address: f.vault, abi: PocketVaultAbi, eventName: 'BondForfeited', fromBlock: 96810000n })
    expect(logs.length).toBe(1)
    expect((logs[0] as any).args.nimiqTxHash).toBe(`0x${'ab'.repeat(32)}`)
    expect((await usdtBal('0x000000000000000000000000000000000000dEaD')) - burnBefore).toBeGreaterThanOrEqual(4_999_999n)
    expect((await w()).forfeited).toBe(0) // no second attempt
    db.close()
  })
})

describe('live Nimiq testnet RPC (read-only)', () => {
  it('reads a real staker and treats only "No staker" as zero stake', async () => {
    const rpc = new NimiqRpc('https://rpc.testnet.nimiqwatch.com')
    const s = await rpc.activeStake('NQ28 14BK PQR5 2EB3 L744 LT46 AV6G H1PJ N6X0')
    expect(s.found).toBe(true)
    expect(s.active).toBeGreaterThan(0)
    const none = await rpc.activeStake('NQ49 BNYM V98H 1KMT 8ME3 8AQ5 GEXD DYSG C652')
    expect(none).toEqual({ active: 0, found: false })
    await expect(new NimiqRpc('https://rpc.testnet.nimiqwatch.com').call('getStakersByValidatorAddress', ['x'])).rejects.toThrow()
  })
})

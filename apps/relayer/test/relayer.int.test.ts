// Gate 2 integration tests: relayer policy, gasless flow, nonce queue, scheduler idempotency, watcher + attester.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { encodeFunctionData, parseAbi, type Abi, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { KeyPair } from '@nimiq/core'
import { vaultTyped, groupTyped, usdtMetaTxTyped, linkMessage, linkHash, PocketVaultAbi, GroupKittyAbi } from '@kittora/core'
import { startFork, fundUsdt, ANVIL_KEYS, USDT } from './fork.ts'
import { build } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { schedulerTick } from '../src/scheduler.ts'
import { settleRelays } from '../src/app.ts'
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
    VAULT_ADDRESS: f.vault, GROUP_KITTY_ADDRESS: f.group, DEPLOY_BLOCK: '96810001', DB_PATH: join(dir, `db-${Math.random()}.sqlite`), LOG_LEVEL: 'silent', ...over,
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
      gracePeriod: 172_800n, interestBps: 1000, maxLoanMultipleBps: 30000, maxSharesPerMeeting: 5, approvalsRequired: 2, maxMembers: 10, maxSocialPayout: 0n, name: 'Concurrency', purpose: '', coverId: 0, nonce: n, deadline: BigInt(DL()),
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

describe('Group Kitty cycle through the relayer + group/activity index (Phase 5)', () => {
  it('create, join, buy, guaranteed loan, disburse, repay, grant, Share-Out; index lists loans, grants, activity', async () => {
    const chainTs = async () => (await f.pub.getBlock()).timestamp
    // Deadlines must be ahead of both wall clock (relayer) and chain time (contract, warped by earlier tests).
    const dl = async () => BigInt(Math.max(Math.floor(Date.now() / 1000), Number(await chainTs())) + 3600)
    const [A, B, C] = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()))
    for (const u of [A, B, C]) await fundUsdt(f, u.address, 20_000_000n)
    const send = async (u: PrivateKeyAccount, action: string, primary: string, msg: Record<string, unknown>) => {
      const params = Object.fromEntries(Object.entries(msg).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : Array.isArray(v) ? v.map(String) : v]))
      const res = await post(r.app, { action, params, signature: await signGroup(u, primary, msg) })
      expect(res.body.error, `${action}: ${res.body.message}`).toBeUndefined()
      const rc = await wait(res.body.hash)
      expect(rc.status).toBe('success')
      return rc
    }
    const gn = (u: PrivateKeyAccount) => nonceOf(f.group, u.address)
    const gkRead = (fn: string, args: unknown[]) => (f.pub.readContract as any)({ address: f.group, abi: GroupKittyAbi as Abi, functionName: fn, args }) as Promise<any>

    const start = await chainTs()
    await send(A, 'group.createGroup', 'CreateGroup', {
      creator: A.address, sharePrice: 1_000_000n, socialFundPerMeeting: 200_000n, meetingInterval: 3600n, cycleEnd: start + 5n * 3600n,
      gracePeriod: 600n, interestBps: 1000, maxLoanMultipleBps: 30000, maxSharesPerMeeting: 5, approvalsRequired: 1, maxMembers: 5,
      maxSocialPayout: 500_000n, name: 'Night Market', purpose: 'Traders, Yaba', coverId: 2, nonce: await gn(A), deadline: await dl(),
    })
    const g = await gkRead('groupCount', [])
    for (const u of [B, C]) await send(u, 'group.join', 'JoinGroup', { member: u.address, groupId: g, nonce: await gn(u), deadline: await dl() })
    for (const u of [A, B, C]) {
      await wait((await gaslessApprove(u, f.group, 20_000_000n)).body.hash)
      await send(u, 'group.buyShares', 'BuyShares', { member: u.address, groupId: g, shares: 5n, nonce: await gn(u), deadline: await dl() })
    }

    // B borrows 8: own 5 shares (value 5) + C pledges 3 shares. Interest 10% = 0.8.
    await send(B, 'group.requestLoan', 'RequestLoan', { borrower: B.address, groupId: g, principal: 8_000_000n, duration: 3600n, guarantors: [C.address], pledges: [3n], nonce: await gn(B), deadline: await dl() })
    const loanId = await gkRead('loanCount', [])
    await send(C, 'group.approveLoan', 'ApproveLoan', { member: C.address, loanId, nonce: await gn(C), deadline: await dl() })
    const d = await post(r.app, { action: 'group.disburse', params: { loanId: String(loanId) } })
    expect(d.body.error).toBeUndefined()
    await wait(d.body.hash)
    expect((await gkRead('loan', [loanId])).status).toBe(2) // Disbursed
    await send(B, 'group.repay', 'Repay', { payer: B.address, loanId, amount: 8_800_000n, nonce: await gn(B), deadline: await dl() })
    expect((await gkRead('loan', [loanId])).status).toBe(3) // Repaid
    expect((await gkRead('members', [g, C.address]))[3]).toBe(0n) // pledge released

    // A1.1 profile + A1.4 roles through the relayer
    expect((await gkRead('profile', [g])).name).toBe('Night Market')
    await send(A, 'group.updateProfile', 'UpdateProfile', { admin: A.address, groupId: g, name: 'Night Market Kitty', purpose: 'Traders, Yaba', coverId: 4, nonce: await gn(A), deadline: await dl() })
    expect((await gkRead('profile', [g])).coverId).toBe(4)
    await send(A, 'group.setTreasurer', 'SetTreasurer', { admin: A.address, groupId: g, member: C.address, enabled: true, nonce: await gn(A), deadline: await dl() })
    expect(await gkRead('isTreasurer', [g, C.address])).toBe(true)

    // A1.5 social fund payment: A proposes 0.3 for A (cap 0.5), C (Treasurer) approves (1 approval required) → executed.
    await send(A, 'group.proposeSocialPayout', 'ProposeSocialPayout', { proposer: A.address, groupId: g, recipient: A.address, amount: 300_000n, reason: 'Medical bill', nonce: await gn(A), deadline: await dl() })
    const payoutId = await gkRead('payoutCount', [])
    await send(C, 'group.approveSocialPayout', 'ApproveSocialPayout', { member: C.address, payoutId, nonce: await gn(C), deadline: await dl() })
    const aBefore = await usdtBal(A.address)
    const ex = await post(r.app, { action: 'group.executeSocialPayout', params: { payoutId: String(payoutId) } })
    expect(ex.body.error, ex.body.message).toBeUndefined()
    await wait(ex.body.hash)
    expect((await usdtBal(A.address)) - aBefore).toBe(300_000n)
    expect((await gkRead('payout', [payoutId])).executed).toBe(true)

    // A1.3 group Autosave: one attempt per meeting window; a window already paid by hand is skipped, not doubled
    await wait((await gaslessApprove(B, f.vault, 10_000_000n)).body.hash)
    const vn = await nonceOf(f.vault, B.address)
    const mMsg = { owner: B.address, amountPerRun: 1_200_000n, interval: 3600n, maxRuns: 3, expiry: start + 5n * 3600n, toGroup: true, destId: g, nonce: vn, deadline: await dl() }
    const mc = await post(r.app, { action: 'vault.createMandate', params: Object.fromEntries(Object.entries(mMsg).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v])), signature: await signVault(B, 'CreateMandate', mMsg) })
    expect(mc.body.error, mc.body.message).toBeUndefined()
    await wait(mc.body.hash)
    const mandateId = await f.pub.readContract({ address: f.vault, abi: PocketVaultAbi, functionName: 'mandateCount' }) as bigint
    const slog = pino({ level: 'silent' })
    const groupTick = async () => {
      const t = Number(await chainTs()) * 1000
      return schedulerTick({ pub: f.pub as any, sender: r.sender, db: r.deps.db, log: slog, vault: f.vault, usdt: USDT, group: f.group, now: () => t })
    }
    expect((await groupTick()).sent).toBe(0) // window 0: B already bought by hand → skipped
    expect((await groupTick()).sent).toBe(0) // still window 0: not attempted again
    await f.test.increaseTime({ seconds: 3600 })
    await f.test.mine({ blocks: 1 })
    expect((await groupTick()).sent).toBe(1) // window 1 runs
    await new Promise(res => setTimeout(res, 1500))
    const win1 = (await gkRead('meetingIndex', [g])) as bigint
    expect(await gkRead('sharesInMeeting', [g, B.address, win1])).toBe(1n)
    expect((await groupTick()).sent).toBe(0) // once per window

    await settleRelays(r.deps.db, f.pub as any)
    const gi = await (await r.app.request(`/group/${g}`)).json() as any
    expect(gi.loanIds).toEqual([String(loanId)])
    expect(gi.payoutIds).toEqual([String(payoutId)])
    expect(gi.mandateIds).toEqual([String(mandateId)])
    expect(gi.approvers.loans[String(loanId)]).toEqual([C.address.toLowerCase()])
    expect(gi.approvers.payouts[String(payoutId)]).toEqual([C.address.toLowerCase()])
    expect(gi.relays).toEqual([]) // every relayed group tx settled as confirmed
    const wins = gi.autosaveWindows.map((w: any) => `${w.windowIdx}:${w.status}`).sort()
    expect(wins).toEqual([`0:skipped`, `${win1}:sent`].sort())
    expect(gi.autosaveWindows.find((w: any) => w.status === 'skipped').reason).toBe('Already paid by hand this meeting')
    expect((await r.app.request('/group/abc')).status).toBe(400)

    // A1.2 feed: every event with its initiator
    const feed = (await (await r.app.request(`/group/${g}/feed`)).json() as any).items as any[]
    const by = (ev: string) => feed.filter(i => i.event === ev)
    const lc = (u: PrivateKeyAccount) => u.address.toLowerCase()
    expect(by('GroupCreated')[0].actor).toBe(lc(A))
    expect(by('GroupProfileUpdated').map(i => i.actor)).toEqual([lc(A), lc(A)])
    expect(by('RoleChanged').map(i => i.args.newRole)).toEqual([2, 3]) // newest first: Treasurer, then Admin at creation
    expect(by('LoanRequested')[0].actor).toBe(lc(B))
    expect(by('LoanApproved')[0].actor).toBe(lc(C))
    expect(by('LoanDisbursed')[0].actor).toBeUndefined() // permissionless
    expect(by('LoanRepaid')[0].actor).toBe(lc(B))
    expect(by('SocialPayoutProposed')[0].actor).toBe(lc(A))
    expect(by('SocialPayoutApproved')[0].actor).toBe(lc(C))
    expect(by('SocialPayoutExecuted')).toHaveLength(1)
    expect(by('GroupMandateCreated')[0].actor).toBe(lc(B))
    expect(by('SharesBought').filter(i => i.actor === 'autosave')).toHaveLength(1)
    expect(by('SharesBought').filter(i => i.actor !== 'autosave')).toHaveLength(3)
    expect(feed.every(i => typeof i.ts === 'number' && /^0x[0-9a-f]{64}$/.test(i.hash))).toBe(true)

    // A1.2 gate: a fresh relayer (empty memory, new DB) rebuilds the same feed from chain data
    const r2 = build(cfg())
    const feed2 = (await (await r2.app.request(`/group/${g}/feed`)).json() as any).items as any[]
    expect(feed2.map(i => `${i.hash}:${i.logIndex}:${i.event}:${i.actor ?? ''}`)).toEqual(feed.map(i => `${i.hash}:${i.logIndex}:${i.event}:${i.actor ?? ''}`))
    r2.stop()

    const actB = await (await r.app.request(`/activity/${B.address}`)).json() as any
    const evB = actB.items.map((i: any) => i.event)
    for (const e of ['MemberJoined', 'SharesBought', 'LoanRequested', 'LoanApproved', 'LoanDisbursed', 'LoanRepaid', 'MandateExecuted']) expect(evB).toContain(e)
    expect(evB[0]).toBe('SharesBought') // newest first: the Autosave run (GroupKitty logs after the vault's MandateExecuted)
    expect(actB.items.every((i: any) => /^0x[0-9a-f]{64}$/.test(i.hash) && typeof i.ts === 'number')).toBe(true)
    const evC = (await (await r.app.request(`/activity/${C.address}`)).json() as any).items.map((i: any) => i.event)
    expect(evC).toContain('LoanRequested') // guarantor sees the loan they back
    expect(evC).toContain('LoanDisbursed')
    expect((await r.app.request('/activity/0x123')).status).toBe(400)

    // Share-Out after cycle end: cash 16.8 (15 + 0.8 interest + 1 Autosave share), social 0.5 → total paid exactly 17.3.
    await f.test.increaseTime({ seconds: 6 * 3600 })
    await f.test.mine({ blocks: 1 })
    const before = await Promise.all([A, B, C].map(u => usdtBal(u.address)))
    for (const u of [A, B, C]) await send(u, 'group.claimShareOut', 'ClaimShareOut', { member: u.address, groupId: g, rollPocketId: 0n, nonce: await gn(u), deadline: await dl() })
    const after = await Promise.all([A, B, C].map(u => usdtBal(u.address)))
    const paid = after.map((x, i) => x - before[i])
    expect(paid.reduce((a, b) => a + b, 0n)).toBe(17_300_000n)
    // A and C: 16.8 × 5/16 + 0.5/3 = 5.25 + 0.1667; B: 16.8 × 6/16 + 0.1667 = 6.3 + 0.1667 (rounding dust to the last claimer)
    expect(paid[0] >= 5_416_666n && paid[0] <= 5_416_668n).toBe(true)
    expect(paid[1] >= 6_466_666n && paid[1] <= 6_466_668n).toBe(true)
    const evA = (await (await r.app.request(`/activity/${A.address}`)).json() as any).items.map((i: any) => i.event)
    expect(evA[0]).toBe('ShareOutClaimed')
  }, 300_000)
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

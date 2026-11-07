import { Hono } from 'hono'
import { cors } from 'hono/cors'
import pino from 'pino'
import type { Abi, Hex, PublicClient } from 'viem'
import { GroupKittyAbi } from '@kittora/core'
import { loadConfig, type Config } from './config.ts'
import { makeChain, publicClient, RelayError, TxSender } from './chain.ts'
import { openDb, openPgDb, pgPool, relayStatus, mandateWindows, eq, and, gt, type Db } from './db.ts'
import { NimiqRpc } from './nimiq.ts'
import { handleRelay, type Deps, type RelayRequest } from './policy.ts'
import { schedulerTick } from './scheduler.ts'
import { watcherTick } from './watcher.ts'
import { Auth } from './auth.ts'
import { Indexer } from './indexer.ts'
import { randomBytes } from 'node:crypto'

export function build(cfg: Config = loadConfig()) {
  const log = pino({ level: cfg.LOG_LEVEL, redact: ['*.privateKey', '*.RELAYER_PRIVATE_KEY', '*.ATTESTER_PRIVATE_KEY'] })
  const chain = makeChain(cfg.CHAIN_ID)
  const pub = publicClient(cfg.POLYGON_RPC_URL, chain)
  const sender = new TxSender(pub, cfg.RELAYER_PRIVATE_KEY as Hex, chain, cfg.POLYGON_RPC_URL, log.child({ wallet: 'relayer' }), cfg.GAS_CAP)
  const attester = cfg.ATTESTER_PRIVATE_KEY
    ? new TxSender(pub, cfg.ATTESTER_PRIVATE_KEY as Hex, chain, cfg.POLYGON_RPC_URL, log.child({ wallet: 'attester' }), cfg.GAS_CAP)
    : null
  const { db, ready: dbReady, close } = cfg.DATABASE_URL ? openPgDb(pgPool(cfg.DATABASE_URL)) : openDb(cfg.DB_PATH)
  const nimiq = new NimiqRpc(cfg.NIMIQ_RPC_URL)
  const addresses = { vault: cfg.VAULT_ADDRESS, group: cfg.GROUP_KITTY_ADDRESS, usdt: cfg.USDT_ADDRESS }
  const deps: Deps = { pub, sender, db, nimiq, chainId: cfg.CHAIN_ID, addresses, rateLimitPerHour: cfg.RATE_LIMIT_PER_HOUR }

  if (!cfg.SESSION_SECRET) log.warn('SESSION_SECRET not set: using a random one (sessions reset on restart)')
  const auth = new Auth(cfg.SESSION_SECRET ?? randomBytes(32).toString('hex'))
  const indexer = new Indexer(pub, addresses.vault, addresses.group, cfg.DEPLOY_BLOCK, cfg.LOG_CHUNK, cfg.INDEX_WAIT_MS)

  const app = new Hono()
  app.use('*', cors())

  app.get('/auth/challenge', c => c.json(auth.challenge()))
  app.post('/auth/verify', async (c) => {
    try {
      return c.json(auth.verify(await c.req.json()))
    } catch (e) {
      return c.json({ error: 'auth_failed', message: (e as Error).message }, 401)
    }
  })

  /** Active NIM stake for an address on the configured Nimiq network (used before locking a bond). */
  app.get('/nimiq/staker/:address', async (c) => {
    try {
      const s = await nimiq.activeStake(decodeURIComponent(c.req.param('address')))
      return c.json({ ...s, rpc: cfg.NIMIQ_RPC_URL })
    } catch (e) {
      return c.json({ error: 'rpc_down', message: 'Nimiq network not reachable, please retry' }, 503)
    }
  })

  const plain = (r: unknown) => JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
  const indexed = (fn: () => Promise<unknown>) => async (c: any) => {
    try {
      return c.json(plain(await fn()))
    } catch (e) {
      log.error({ err: String(e) }, 'indexer error')
      return c.json({ error: 'rpc_down', message: 'could not read the chain, please retry' }, 503)
    }
  }
  const isEvm = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s)
  const badParams = (c: any, message: string) => c.json({ error: 'bad_params', message }, 400)

  /** Which pockets/groups/bonds/mandates an EVM address has (ids only; read values live from chain). */
  app.get('/me/:evm', (c) => {
    const evm = c.req.param('evm')
    return isEvm(evm) ? indexed(() => indexer.of(evm))(c) : badParams(c, 'bad address')
  })

  /** Group of a relay request, read from the contract (the index may lag a new loan or payment by seconds). */
  const groupOf = async (params: Record<string, unknown>): Promise<{ groupId: bigint | null, refId: bigint | null }> => {
    const n = (v: unknown) => (v === undefined || v === null ? null : BigInt(String(v)))
    const gk = GroupKittyAbi as Abi
    if (params.groupId !== undefined) return { groupId: n(params.groupId), refId: null }
    if (params.loanId !== undefined) {
      const l = await pub.readContract({ address: addresses.group, abi: gk, functionName: 'loan', args: [BigInt(String(params.loanId))] }) as { groupId: bigint }
      return { groupId: l.groupId || null, refId: n(params.loanId) }
    }
    if (params.payoutId !== undefined) {
      const po = await pub.readContract({ address: addresses.group, abi: gk, functionName: 'payout', args: [BigInt(String(params.payoutId))] }) as { groupId: bigint }
      return { groupId: po.groupId || null, refId: n(params.payoutId) }
    }
    return { groupId: null, refId: null }
  }

  const RECENT = 14 * 86_400 // relay and Autosave records shown in the feed (older ones live on-chain only)

  /** A group's loan / payment / mandate ids and approvers, plus our own tracking: relays not yet confirmed or failed,
   * and Autosave windows that were skipped or failed (A1.2, A1.3). */
  app.get('/group/:id', (c) => {
    const id = c.req.param('id')
    if (!/^\d{1,12}$/.test(id)) return badParams(c, 'bad group id')
    return indexed(async () => {
      const since = Math.floor(Date.now() / 1000) - RECENT
      const [ix, relays, windows] = await Promise.all([
        indexer.groupIndex(BigInt(id)),
        db.select().from(relayStatus).where(and(eq(relayStatus.groupId, Number(id)), gt(relayStatus.createdAt, since))).all(),
        db.select().from(mandateWindows).where(and(eq(mandateWindows.groupId, Number(id)), gt(mandateWindows.updatedAt, since))).all(),
      ])
      return { ...ix, relays: relays.filter(r => r.status !== 'confirmed'), autosaveWindows: windows }
    })(c)
  })

  /** A1.2: the group's on-chain feed with initiators (rebuilt from chain logs on every start). */
  app.get('/group/:id/feed', (c) => {
    const id = c.req.param('id')
    return /^\d{1,12}$/.test(id) ? indexed(() => indexer.groupFeed(BigInt(id)))(c) : badParams(c, 'bad group id')
  })

  /** On-chain activity of an address, newest first, with tx hashes and block times. */
  app.get('/activity/:evm', (c) => {
    const evm = c.req.param('evm')
    return isEvm(evm) ? indexed(() => indexer.activity(evm))(c) : badParams(c, 'bad address')
  })

  app.post('/relay', async (c) => {
    let body: RelayRequest
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'bad_json', message: 'body must be JSON' }, 400)
    }
    const clientKey = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
    try {
      const { hash } = await handleRelay(body, deps, clientKey)
      await trackRelay(db, hash, body, groupOf).catch(e => log.warn({ err: String(e) }, 'relay tracking not saved'))
      return c.json({ hash, status: 'pending' })
    } catch (e) {
      if (e instanceof RelayError) {
        log.info({ action: body?.action, code: e.code }, 'relay rejected')
        return c.json({ error: e.code, message: e.message }, e.status as 400)
      }
      log.error({ err: String(e) }, 'relay error')
      return c.json({ error: 'internal', message: 'relay failed, please retry' }, 500)
    }
  })

  app.get('/status/:hash', async (c) => {
    const hash = c.req.param('hash') as Hex
    const r = await pub.getTransactionReceipt({ hash }).catch(() => null)
    if (!r) return c.json({ hash, status: 'pending' })
    return c.json({ hash, status: r.status === 'success' ? 'confirmed' : 'failed', block: Number(r.blockNumber) })
  })

  const health = { lowBalance: false, relayerPol: '0', attesterPol: null as string | null, lastScheduler: 0, lastWatcher: 0 }
  app.get('/health', c => c.json({ ok: !health.lowBalance, relayer: sender.account.address, attester: attester?.account.address ?? null, ...health }))

  async function checkBalances() {
    const bal = await pub.getBalance({ address: sender.account.address })
    health.relayerPol = bal.toString()
    health.lowBalance = bal < cfg.MIN_POL_WEI
    if (health.lowBalance) log.warn({ balance: bal.toString(), min: cfg.MIN_POL_WEI.toString() }, 'ALERT relayer hot wallet POL low')
    if (attester) {
      const a = await pub.getBalance({ address: attester.account.address })
      health.attesterPol = a.toString()
      if (a < cfg.MIN_POL_WEI / 5n) log.warn({ balance: a.toString() }, 'ALERT attester POL low')
    }
  }

  const timers: NodeJS.Timeout[] = []
  function startLoops() {
    const loop = (ms: number, fn: () => Promise<unknown>) => {
      const tick = () => fn().catch(e => log.error({ err: String(e) }, 'loop error'))
      tick()
      timers.push(setInterval(tick, ms))
    }
    // Keep the read index warm so API requests rarely wait on a catch-up.
    loop(15_000, () => indexer.sync())
    // Submitted → Confirmed / Failed from receipts (A1.2: status never comes from optimistic UI state)
    loop(15_000, () => settleRelays(db, pub))
    loop(cfg.SCHEDULER_INTERVAL_MS, async () => {
      await checkBalances()
      const r = await schedulerTick({ pub, sender, db, log: log.child({ svc: 'scheduler' }), vault: addresses.vault, usdt: addresses.usdt, group: addresses.group })
      health.lastScheduler = Date.now()
      if (r.sent || r.confirmed) log.info(r, 'scheduler tick')
    })
    if (attester) {
      loop(cfg.WATCHER_INTERVAL_MS, async () => {
        const r = await watcherTick({ pub, attester, db, log: log.child({ svc: 'watcher' }), nimiq, vault: addresses.vault })
        health.lastWatcher = Date.now()
        if (r.forfeited) log.warn(r, 'watcher tick')
      })
    } else {
      log.warn('ATTESTER_PRIVATE_KEY not set: watcher disabled')
    }
  }

  return { app, log, dbReady, deps, auth, indexer, sender, attester, startLoops, stop: () => { timers.forEach(clearInterval); close() } }
}

/** Records a relayed tx with its group so the group feed can show it as Submitted until its receipt arrives. */
export async function trackRelay(db: Db, hash: string, body: RelayRequest, groupOf: (p: Record<string, unknown>) => Promise<{ groupId: bigint | null, refId: bigint | null }>) {
  const params = (body?.params ?? {}) as Record<string, unknown>
  const { groupId, refId } = await groupOf(params)
  const now = Math.floor(Date.now() / 1000)
  const signer = String(params.member ?? params.borrower ?? params.payer ?? params.proposer ?? params.admin ?? params.creator ?? params.owner ?? '').toLowerCase()
  await db.insert(relayStatus).values({
    hash, action: String(body.action), signer, groupId: groupId === null ? null : Number(groupId), refId: refId === null ? null : Number(refId),
    status: 'submitted', createdAt: now, updatedAt: now,
  }).onConflictDoNothing()
}

/** Moves submitted relays to confirmed / failed once their receipt is on-chain. */
export async function settleRelays(db: Db, pub: PublicClient) {
  const open = await db.select().from(relayStatus).where(eq(relayStatus.status, 'submitted')).all()
  for (const r of open.slice(0, 50)) {
    const rc = await pub.getTransactionReceipt({ hash: r.hash as Hex }).catch(() => null)
    if (!rc) continue
    await db.update(relayStatus).set({ status: rc.status === 'success' ? 'confirmed' : 'failed', updatedAt: Math.floor(Date.now() / 1000) }).where(eq(relayStatus.hash, r.hash))
  }
}

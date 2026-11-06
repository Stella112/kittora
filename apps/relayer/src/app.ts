import { Hono } from 'hono'
import { cors } from 'hono/cors'
import pino from 'pino'
import type { Hex } from 'viem'
import { loadConfig, type Config } from './config.ts'
import { makeChain, publicClient, RelayError, TxSender } from './chain.ts'
import { openDb } from './db.ts'
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
  const { db, close } = openDb(cfg.DB_PATH)
  const nimiq = new NimiqRpc(cfg.NIMIQ_RPC_URL)
  const addresses = { vault: cfg.VAULT_ADDRESS, group: cfg.GROUP_KITTY_ADDRESS, usdt: cfg.USDT_ADDRESS }
  const deps: Deps = { pub, sender, db, nimiq, chainId: cfg.CHAIN_ID, addresses, rateLimitPerHour: cfg.RATE_LIMIT_PER_HOUR }

  if (!cfg.SESSION_SECRET) log.warn('SESSION_SECRET not set: using a random one (sessions reset on restart)')
  const auth = new Auth(cfg.SESSION_SECRET ?? randomBytes(32).toString('hex'))
  const indexer = new Indexer(pub, addresses.vault, addresses.group, cfg.DEPLOY_BLOCK)

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

  /** Which pockets/groups/bonds/mandates an EVM address has (ids only; read values live from chain). */
  app.get('/me/:evm', async (c) => {
    const evm = c.req.param('evm')
    if (!/^0x[0-9a-fA-F]{40}$/.test(evm)) return c.json({ error: 'bad_params', message: 'bad address' }, 400)
    try {
      const r = await indexer.of(evm)
      return c.json(JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))))
    } catch (e) {
      log.error({ err: String(e) }, 'indexer error')
      return c.json({ error: 'rpc_down', message: 'could not read the chain, please retry' }, 503)
    }
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
    loop(cfg.SCHEDULER_INTERVAL_MS, async () => {
      await checkBalances()
      const r = await schedulerTick({ pub, sender, db, log: log.child({ svc: 'scheduler' }), vault: addresses.vault, usdt: addresses.usdt })
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

  return { app, log, deps, auth, indexer, sender, attester, startLoops, stop: () => { timers.forEach(clearInterval); close() } }
}

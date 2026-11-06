import { serve } from '@hono/node-server'
import { loadConfig } from './config.ts'
import { build } from './app.ts'

const cfg = loadConfig()
const { app, log, startLoops, sender, attester, dbReady } = build(cfg)
try {
  await dbReady
} catch (e) {
  log.fatal({ err: String(e) }, 'database not reachable (check DATABASE_URL)')
  process.exit(1)
}
serve({ fetch: app.fetch, port: cfg.PORT }, () => {
  log.info({ port: cfg.PORT, db: cfg.DATABASE_URL ? 'postgres' : 'sqlite', chainId: cfg.CHAIN_ID, relayer: sender.account.address, attester: attester?.account.address }, 'kittora relayer up')
  startLoops()
})

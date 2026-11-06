import { serve } from '@hono/node-server'
import { loadConfig } from './config.ts'
import { build } from './app.ts'

const cfg = loadConfig()
const { app, log, startLoops, sender, attester } = build(cfg)
serve({ fetch: app.fetch, port: cfg.PORT }, () => {
  log.info({ port: cfg.PORT, chainId: cfg.CHAIN_ID, relayer: sender.account.address, attester: attester?.account.address }, 'kittora relayer up')
  startLoops()
})

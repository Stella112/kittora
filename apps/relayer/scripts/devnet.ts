// LOCAL DEVNET (test harness, never production): anvil fork of Polygon with the real contracts deployed by
// Deploy.s.sol, a relayer on :8789, and three anvil dev accounts funded with fork USDT. Writes apps/web/.env.devnet.local
// so `vite --mode devnet` points the mini app at it. Keys are anvil's public, well-known dev keys (test values only).
//   node --experimental-strip-types scripts/devnet.ts
import { serve } from '@hono/node-server'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFork, fundUsdt, ANVIL_KEYS } from '../test/fork.ts'
import { build } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

const ANVIL_PORT = 8547
const RELAYER_PORT = 8789
/** anvil dev accounts #4, #5, #6 act as three group members in the browser. */
export const DEV_MEMBERS = ['0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', '0x976EA74026E726554dB657fA54763abd0C3a0aa9'] as const

const f = await startFork(ANVIL_PORT)
// The fork starts at the pinned block's (old) timestamp; move the chain clock to now so it behaves like mainnet.
await f.test.setNextBlockTimestamp({ timestamp: BigInt(Math.floor(Date.now() / 1000)) })
await f.test.mine({ blocks: 1 })
for (const a of DEV_MEMBERS) await fundUsdt(f, a, 30_000_000n)
const dir = mkdtempSync(join(tmpdir(), 'kittora-devnet-'))
const cfg = loadConfig({
  PORT: String(RELAYER_PORT), POLYGON_RPC_URL: f.url, CHAIN_ID: '137', RELAYER_PRIVATE_KEY: ANVIL_KEYS.relayer, ATTESTER_PRIVATE_KEY: ANVIL_KEYS.attester,
  VAULT_ADDRESS: f.vault, GROUP_KITTY_ADDRESS: f.group, DEPLOY_BLOCK: '96810001', DB_PATH: join(dir, 'devnet.sqlite'), LOG_LEVEL: 'info',
  SESSION_SECRET: 'devnet-only-session-secret', MIN_POL_WEI: '0',
})
const r = build(cfg)
serve({ fetch: r.app.fetch, port: RELAYER_PORT }, () => {
  r.startLoops()
  const env = fileURLToPath(new URL('../../web/.env.devnet.local', import.meta.url))
  writeFileSync(env, [
    '# Written by apps/relayer/scripts/devnet.ts (local anvil fork). Safe to delete.',
    `VITE_RELAYER_URL=http://localhost:${RELAYER_PORT}`,
    `VITE_VAULT_ADDRESS=${f.vault}`,
    `VITE_GROUP_KITTY_ADDRESS=${f.group}`,
    'VITE_CHAIN_ID=137',
    `VITE_DEVNET_RPC=${f.url}`,
    `VITE_DEVNET_MEMBERS=${DEV_MEMBERS.join(',')}`,
    '',
  ].join('\n'))
  console.log(`DEVNET READY anvil=${f.url} relayer=http://localhost:${RELAYER_PORT} vault=${f.vault} group=${f.group}`)
})
const stop = () => { r.stop(); f.proc.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

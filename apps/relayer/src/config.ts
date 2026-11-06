import { z } from 'zod'
import { readFileSync, existsSync } from 'node:fs'

// Load apps/relayer/.env if present (git-ignored). Never log values.
const envFile = new URL('../.env', import.meta.url)
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim()
  }
}

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/)
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(s => s as `0x${string}`)

const schema = z.object({
  PORT: z.coerce.number().default(8788),
  CHAIN_ID: z.coerce.number().default(137),
  POLYGON_RPC_URL: z.string().url(),
  RELAYER_PRIVATE_KEY: hex,
  ATTESTER_PRIVATE_KEY: hex.optional(),
  VAULT_ADDRESS: addr,
  GROUP_KITTY_ADDRESS: addr,
  USDT_ADDRESS: addr.default('0xc2132D05D31c914a87C6611C10748AEb04B58e8F'),
  NIMIQ_RPC_URL: z.string().url().default('https://rpc.testnet.nimiqwatch.com'),
  DB_PATH: z.string().default('relayer.db'),
  GAS_CAP: z.coerce.bigint().default(1_500_000n),
  RATE_LIMIT_PER_HOUR: z.coerce.number().default(60),
  MIN_POL_WEI: z.coerce.bigint().default(500_000_000_000_000_000n), // 0.5 POL
  SCHEDULER_INTERVAL_MS: z.coerce.number().default(60_000),
  WATCHER_INTERVAL_MS: z.coerce.number().default(60_000),
  LOG_LEVEL: z.string().default('info'),
})

export type Config = z.infer<typeof schema>

export function loadConfig(overrides: Record<string, string | undefined> = {}): Config {
  return schema.parse({ ...process.env, ...overrides })
}

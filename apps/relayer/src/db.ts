// Display/ops data only. Never the source of truth for balances (brief §3).
// Local: node:sqlite through Drizzle's sqlite-proxy driver (no native module needed). Production Postgres: see DECISIONS.md.
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { and, eq, gt, sql } from 'drizzle-orm'

export const rateHits = sqliteTable('rate_hits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  ts: integer('ts').notNull(),
})

export const relays = sqliteTable('relays', {
  hash: text('hash').primaryKey(),
  action: text('action').notNull(),
  signer: text('signer').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const mandateRuns = sqliteTable('mandate_runs', {
  key: text('key').primaryKey(), // `${mandateId}:${run}` idempotency key
  mandateId: integer('mandate_id').notNull(),
  run: integer('run').notNull(),
  status: text('status').notNull(), // pending | sent | done | failed
  txHash: text('tx_hash'),
  updatedAt: integer('updated_at').notNull(),
})

export const forfeits = sqliteTable('forfeits', {
  bondId: integer('bond_id').primaryKey(),
  nimiqTx: text('nimiq_tx').notNull(),
  txHash: text('tx_hash'),
  status: text('status').notNull(), // sent | done | failed
  updatedAt: integer('updated_at').notNull(),
})

const DDL = `
CREATE TABLE IF NOT EXISTS rate_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_hits_key_ts ON rate_hits(key, ts);
CREATE TABLE IF NOT EXISTS relays (hash TEXT PRIMARY KEY, action TEXT NOT NULL, signer TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mandate_runs (key TEXT PRIMARY KEY, mandate_id INTEGER NOT NULL, run INTEGER NOT NULL, status TEXT NOT NULL, tx_hash TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS forfeits (bond_id INTEGER PRIMARY KEY, nimiq_tx TEXT NOT NULL, tx_hash TEXT, status TEXT NOT NULL, updated_at INTEGER NOT NULL);
`

export function openDb(path: string) {
  const sqlite = new DatabaseSync(path)
  sqlite.exec(DDL)
  const db = drizzle(async (q, params, method) => {
    const st = sqlite.prepare(q)
    const p = params as (string | number | null)[]
    if (method === 'run') {
      st.run(...p)
      return { rows: [] }
    }
    if (method === 'get') {
      const r = st.get(...p) as Record<string, unknown> | undefined
      return { rows: r ? (Object.values(r) as never) : (undefined as never) }
    }
    return { rows: (st.all(...p) as Record<string, unknown>[]).map(r => Object.values(r)) as never }
  })
  return { db, close: () => sqlite.close() }
}

export type Db = ReturnType<typeof openDb>['db']
export { and, eq, gt, sql }

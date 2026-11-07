// Display/ops data only. Never the source of truth for balances (brief §3).
// Local: node:sqlite through Drizzle's sqlite-proxy driver (no native module needed).
// Production: Postgres (Neon, DECISIONS.md item 14) through the same driver when DATABASE_URL is set.
import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'

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

/** A1.2: every relayed tx with its group, so the feed can show Submitted → Confirmed / Failed from our own tracking. */
export const relayStatus = sqliteTable('relay_status', {
  hash: text('hash').primaryKey(),
  action: text('action').notNull(),
  signer: text('signer').notNull(),
  groupId: integer('group_id'),
  refId: integer('ref_id'), // loanId / payoutId when the action names one
  status: text('status').notNull(), // submitted | confirmed | failed
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** A1.3: one Autosave attempt per group mandate per meeting window (`${mandateId}:${window}`). */
export const mandateWindows = sqliteTable('mandate_windows', {
  key: text('key').primaryKey(),
  mandateId: integer('mandate_id').notNull(),
  groupId: integer('group_id').notNull(),
  member: text('member').notNull(),
  windowIdx: integer('window_idx').notNull(),
  status: text('status').notNull(), // sent | skipped (already paid this window) | failed
  reason: text('reason'),
  txHash: text('tx_hash'),
  updatedAt: integer('updated_at').notNull(),
})

/** Nimiq memo stamps, keyed by the Polygon tx they stamp (first verified stamp wins). */
export const stamps = sqliteTable('stamps', {
  polygonTx: text('polygon_tx').primaryKey(),
  nimiqTx: text('nimiq_tx').notNull(),
  code: text('code').notNull(),
  groupId: integer('group_id').notNull(),
  createdAt: integer('created_at').notNull(),
})

const DDL = `
CREATE TABLE IF NOT EXISTS rate_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_hits_key_ts ON rate_hits(key, ts);
CREATE TABLE IF NOT EXISTS relays (hash TEXT PRIMARY KEY, action TEXT NOT NULL, signer TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mandate_runs (key TEXT PRIMARY KEY, mandate_id INTEGER NOT NULL, run INTEGER NOT NULL, status TEXT NOT NULL, tx_hash TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS forfeits (bond_id INTEGER PRIMARY KEY, nimiq_tx TEXT NOT NULL, tx_hash TEXT, status TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relay_status (hash TEXT PRIMARY KEY, action TEXT NOT NULL, signer TEXT NOT NULL, group_id INTEGER, ref_id INTEGER, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS relay_status_group ON relay_status(group_id);
CREATE TABLE IF NOT EXISTS mandate_windows (key TEXT PRIMARY KEY, mandate_id INTEGER NOT NULL, group_id INTEGER NOT NULL, member TEXT NOT NULL, window_idx INTEGER NOT NULL, status TEXT NOT NULL, reason TEXT, tx_hash TEXT, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mandate_windows_group ON mandate_windows(group_id);
CREATE TABLE IF NOT EXISTS stamps (polygon_tx TEXT PRIMARY KEY, nimiq_tx TEXT NOT NULL, code TEXT NOT NULL, group_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
`

// Postgres (Neon in production). Same Drizzle schema and queries: the sqlite-proxy driver emits plain SQL with `?`
// placeholders, which we number for Postgres. Only these simple tables and queries go through it.
// rate_hits.id has no primary key here because the sqlite dialect inserts NULL for it (it is an append-only log).
const DDL_PG = `
CREATE TABLE IF NOT EXISTS rate_hits (id BIGINT, key TEXT NOT NULL, ts BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS rate_hits_key_ts ON rate_hits(key, ts);
CREATE TABLE IF NOT EXISTS relays (hash TEXT PRIMARY KEY, action TEXT NOT NULL, signer TEXT NOT NULL, created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS mandate_runs (key TEXT PRIMARY KEY, mandate_id BIGINT NOT NULL, run BIGINT NOT NULL, status TEXT NOT NULL, tx_hash TEXT, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS forfeits (bond_id BIGINT PRIMARY KEY, nimiq_tx TEXT NOT NULL, tx_hash TEXT, status TEXT NOT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS relay_status (hash TEXT PRIMARY KEY, action TEXT NOT NULL, signer TEXT NOT NULL, group_id BIGINT, ref_id BIGINT, status TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS relay_status_group ON relay_status(group_id);
CREATE TABLE IF NOT EXISTS mandate_windows (key TEXT PRIMARY KEY, mandate_id BIGINT NOT NULL, group_id BIGINT NOT NULL, member TEXT NOT NULL, window_idx BIGINT NOT NULL, status TEXT NOT NULL, reason TEXT, tx_hash TEXT, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS mandate_windows_group ON mandate_windows(group_id);
CREATE TABLE IF NOT EXISTS stamps (polygon_tx TEXT PRIMARY KEY, nimiq_tx TEXT NOT NULL, code TEXT NOT NULL, group_id BIGINT NOT NULL, created_at BIGINT NOT NULL);
`

/** Minimal Postgres client: run a statement, return rows as arrays in column order. */
export interface PgClient {
  exec(sql: string): Promise<void>
  rows(sql: string, params: unknown[]): Promise<unknown[][]>
  close(): Promise<void>
}

/** `?` → `$1, $2, …` (our generated SQL never contains a literal `?`). */
export const toPgPlaceholders = (q: string) => { let i = 0; return q.replace(/\?/g, () => `$${++i}`) }

// int8 (count(*), BIGINT columns) arrives as string or bigint; every value we store fits in a JS number.
const num = (v: unknown) => (typeof v === 'bigint' ? Number(v) : v)

export function openPgDb(client: PgClient) {
  const ready = client.exec(DDL_PG)
  ready.catch(() => undefined) // surfaced by every query and by main.ts, never as an unhandled rejection
  const db = drizzle(async (q, params, method) => {
    await ready
    const rows = (await client.rows(toPgPlaceholders(q), params)).map(r => r.map(num))
    if (method === 'run') return { rows: [] }
    if (method === 'get') return { rows: (rows[0] ?? undefined) as never }
    return { rows: rows as never }
  })
  return { db, ready, close: () => { void client.close() } }
}

/** node-postgres pool for a DATABASE_URL (Neon needs TLS; `sslmode=require` in the URL is honoured). */
export function pgPool(url: string): PgClient {
  pg.types.setTypeParser(20, (v: string) => Number(v)) // int8 → number
  const pool = new pg.Pool({ connectionString: url, max: 5 })
  return {
    exec: async (sql) => { await pool.query(sql) },
    rows: async (sql, params) => (await pool.query({ text: sql, values: params as unknown[], rowMode: 'array' })).rows as unknown[][],
    close: () => pool.end(),
  }
}

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
  return { db, ready: Promise.resolve(), close: () => sqlite.close() }
}

export type Db = ReturnType<typeof openDb>['db']
export { and, eq, gt, inArray, sql }

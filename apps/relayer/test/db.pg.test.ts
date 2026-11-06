// The Postgres backend (Neon in production) runs the same Drizzle queries as SQLite. PGlite is real Postgres compiled
// to WASM, in-process: TEST ONLY, so no database server is needed.
import { describe, it, expect, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { openPgDb, openDb, toPgPlaceholders, rateHits, relays, mandateRuns, forfeits, and, eq, gt, sql, type PgClient } from '../src/db.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const lite = new PGlite()
const client: PgClient = {
  exec: async (s) => { await lite.exec(s) },
  rows: async (s, params) => (await lite.query(s, params as unknown[], { rowMode: 'array' })).rows as unknown[][],
  close: () => lite.close(),
}
const pgDb = openPgDb(client)
const sqliteDb = openDb(join(mkdtempSync(join(tmpdir(), 'kittora-db-')), 'x.sqlite'))
afterAll(() => { pgDb.close(); sqliteDb.close() })

describe('placeholders', () => {
  it('numbers ? for Postgres', () => {
    expect(toPgPlaceholders('select * from "t" where "a" = ? and "b" > ?')).toBe('select * from "t" where "a" = $1 and "b" > $2')
  })
})

for (const [name, h] of [['postgres (PGlite)', pgDb], ['sqlite', sqliteDb]] as const) {
  describe(`relayer queries on ${name}`, () => {
    const db = h.db
    it('rate limit: insert hits and count the last hour (as policy.ts does)', async () => {
      await h.ready
      for (const ts of [100, 200, 300]) await db.insert(rateHits).values({ key: '0xabc', ts })
      await db.insert(rateHits).values({ key: '0xdef', ts: 300 })
      const row = await db.select({ n: sql<number>`count(*)` }).from(rateHits).where(and(eq(rateHits.key, '0xabc'), gt(rateHits.ts, 150))).get()
      expect(row?.n).toBe(2)
      expect(typeof row?.n).toBe('number')
    })

    it('relays: record a submission', async () => {
      await db.insert(relays).values({ hash: '0x01', action: 'group.join', signer: '0xabc', createdAt: 1_793_000_000 })
      const r = await db.select().from(relays).where(eq(relays.hash, '0x01')).get()
      expect(r).toEqual({ hash: '0x01', action: 'group.join', signer: '0xabc', createdAt: 1_793_000_000 })
    })

    it('scheduler: idempotency key insert, conflict ignored, status updates (as scheduler.ts does)', async () => {
      await db.insert(mandateRuns).values({ key: '1:1', mandateId: 1, run: 1, status: 'pending', updatedAt: 10 }).onConflictDoNothing()
      await db.insert(mandateRuns).values({ key: '1:1', mandateId: 1, run: 1, status: 'pending', updatedAt: 99 }).onConflictDoNothing()
      await db.update(mandateRuns).set({ status: 'sent', txHash: '0xaa', updatedAt: 11 }).where(eq(mandateRuns.key, '1:1'))
      const r = await db.select().from(mandateRuns).where(eq(mandateRuns.key, '1:1')).get()
      expect(r).toEqual({ key: '1:1', mandateId: 1, run: 1, status: 'sent', txHash: '0xaa', updatedAt: 11 })
      expect(await db.select().from(mandateRuns).where(eq(mandateRuns.key, '9:9')).get()).toBeUndefined()
    })

    it('watcher: one forfeit per bond (as watcher.ts does)', async () => {
      await db.insert(forfeits).values({ bondId: 7, nimiqTx: 'ab'.repeat(32), txHash: '0xbb', status: 'sent', updatedAt: 12 })
      const prior = await db.select().from(forfeits).where(eq(forfeits.bondId, 7)).get()
      expect(prior?.status).toBe('sent')
      await expect(db.insert(forfeits).values({ bondId: 7, nimiqTx: 'cd', txHash: null, status: 'sent', updatedAt: 13 })).rejects.toThrow()
    })
  })
}

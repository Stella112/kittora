# Deploy runbook (Vercel + Railway + Neon, DECISIONS.md item 14)

Order: **Neon → Railway (relayer) → Vercel (web, needs the relayer URL) → smoke test in Nimiq Pay on a phone.**
Contracts are already live on Polygon mainnet (BUILD_LOG.md, Nov 6): nothing to deploy on-chain.

> Secrets (private keys, `SESSION_SECRET`, `DATABASE_URL`) go **only** into the platform's secret settings.
> Never paste them into chat, issues, commits or screenshots. If one leaks, rotate it straight away
> (move the relayer's POL to a new key, generate a new `SESSION_SECRET`, reset the Neon password).

## 1. Neon (Postgres for the relayer's ops data)
1. Create a project (region close to Railway's, e.g. `aws-eu-central-1` with Railway EU).
2. Copy the **pooled** connection string. It looks like `postgresql://…@…-pooler.…neon.tech/neondb?sslmode=require`.
3. Nothing else: the relayer creates its four tables on start (`CREATE TABLE IF NOT EXISTS`).

The database only holds rate-limit hits, relay records, Autosave run idempotency keys and forfeit records.
Balances are always read from the contracts, so a lost database never loses money. The worst case is that an Autosave
run already sent is not recognised, and the contract's interval check rejects the duplicate anyway.

## 2. Railway (relayer)
1. New project → Deploy from GitHub repo `Stella112/kittora`. Railway reads `railway.json` at the root:
   Dockerfile `apps/relayer/Dockerfile`, **1 replica** (scheduler and watcher must run once), health check `/health`.
2. Variables:

| Variable | Value |
|---|---|
| `CHAIN_ID` | `137` |
| `POLYGON_RPC_URL` | A Polygon RPC with receipts + logs. `https://polygon.drpc.org` works but its free plan serves `eth_getLogs` only ~100 blocks per call (its error message wrongly says 10000): the indexer adapts, but catching up from `DEPLOY_BLOCK` takes ~1.5 s per 60 blocks and each read waits ~2 s. A paid key is recommended for the pilot. |
| `RELAYER_PRIVATE_KEY` | **Secret.** Hot wallet `0xb6F9…e962` (holds POL for gas only). |
| `ATTESTER_PRIVATE_KEY` | **Secret.** Attester `0xa592…8a12` (forfeits bonds). Leave unset to disable the watcher. |
| `VAULT_ADDRESS` | `0x7B1e1bAed045Db95b5F5b3E1e6E50efdac851251` |
| `GROUP_KITTY_ADDRESS` | `0x2271dA8756185B48A46A17051fF3A90d6481ed5f` |
| `DEPLOY_BLOCK` | `96840641` (first indexed block) |
| `DATABASE_URL` | **Secret.** The Neon pooled string from step 1. |
| `SESSION_SECRET` | **Secret.** 32+ random characters (`openssl rand -hex 32`). Without it, sign-ins reset on every restart. |
| `NIMIQ_RPC_URL` | Defaults to mainnet `https://rpc.nimiqwatch.com`. Set to the testnet RPC only for a testnet pilot. |
| `MIN_POL_WEI` | Optional. Low-balance alert threshold, default 0.5 POL. |
| `LOG_CHUNK` | Optional. Starting `eth_getLogs` span, default 9000; shrinks automatically when the RPC refuses a range. |
| `INDEX_WAIT_MS` | Optional. Longest a read waits for the indexer to catch up (default 5000); it then answers with what it has and keeps syncing. |

`PORT` is set by Railway. `DB_PATH` is not used when `DATABASE_URL` is set.

3. Networking → Generate domain. Check `https://<relayer>/health` returns `{"ok":true, "relayer":"0xb6F9…", …}`.
   `ok:false` means the hot wallet is below `MIN_POL_WEI`: top it up with POL.
4. Logs should show `kittora relayer up` with `db: "postgres"`. A `database not reachable` line means `DATABASE_URL` is wrong.

## 3. Vercel (mini app)
1. New project → import `Stella112/kittora` → **Root Directory `apps/web`**. `apps/web/vercel.json` sets the install,
   build, output and the SPA rewrite (needed so invite links like `/groups/3` load the app).
2. Environment variables (Production):

| Variable | Value |
|---|---|
| `VITE_RELAYER_URL` | `https://<relayer>` from step 2 (no trailing slash) |
| `VITE_VAULT_ADDRESS` | `0x7B1e1bAed045Db95b5F5b3E1e6E50efdac851251` |
| `VITE_GROUP_KITTY_ADDRESS` | `0x2271dA8756185B48A46A17051fF3A90d6481ed5f` |
| `VITE_CHAIN_ID` | `137` |
| `VITE_PUBLIC_URL` | The Vercel production URL, e.g. `https://kittora.vercel.app` (used in invite links) |
| `VITE_NIM_VALIDATOR` | Maris's validator pick (NIM SafeLock). Until set, NIM SafeLock staking cannot start. |

3. Deploy, then open the URL in a desktop browser: it should show **Open Kittora in Nimiq Pay** with two links.
   That is the expected screen outside Nimiq Pay.

## 4. Smoke test on a phone (Nimiq Pay)
Open `https://nimpay.app/miniapps/open/<vercel-host>` on the phone, then:
1. Sign in (Nimiq signature) → Connect Polygon.
2. Save → Flex → deposit 1 USDT → Activity shows it with a Polygonscan link.
3. Groups → Start a group (hourly pilot) → share the invite → a second phone joins → both buy 1 share.
4. Relayer `/health` POL balance went down a little; the users' POL stayed at 0.

Record each check in the BUILD_LOG.md test matrix (device, OS, Nimiq Pay version, result).

## Local equivalents
- Relayer against Postgres: `DATABASE_URL=postgresql://… pnpm --filter @kittora/relayer dev`
- Everything on a fork: `pnpm --filter @kittora/relayer devnet`, then the `web-devnet` launch config (BUILD_LOG.md, Phase 5).
- Container: `docker build -f apps/relayer/Dockerfile .` from the repo root.

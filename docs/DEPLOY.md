# Deploy runbook

**Main path: one VPS** running `deploy/vps/docker-compose.yml`:
- `https://kittora.xyz`: the mini app (static build, served by Caddy)
- `https://api.kittora.xyz`: the relayer (behind Caddy, not exposed directly)
- Caddy gets and renews the HTTPS certificates automatically. The relayer keeps its ops data in SQLite on a Docker
  volume, so no database service is needed.

Contracts are already live on Polygon mainnet (BUILD_LOG.md, Nov 6): nothing to deploy on-chain.

> Secrets (relayer and attester private keys, `SESSION_SECRET`) go **only** into `deploy/vps/relayer.env` on the
> server. Never paste them into chat, issues, commits or screenshots. If one leaks, rotate it straight away (move the
> relayer's POL to a new key, generate a new `SESSION_SECRET`).

## 1. VPS
Any provider. Ubuntu 24.04, **2 GB RAM** (the web build needs it; with 1 GB add swap, step 3), 20 GB disk, a public IPv4.
Use SSH-key login.

## 2. DNS (at the registrar where you bought the domain)
| Type | Name | Value |
|---|---|---|
| A | `@` | VPS IPv4 |
| A | `api` | VPS IPv4 |
| A | `www` | VPS IPv4 (optional, redirects to the root) |

Wait until `nslookup kittora.xyz` and `nslookup api.kittora.xyz` return the VPS IP. Caddy can only get certificates
once DNS points at the server.

## 3. Server setup (once)
```bash
ssh root@<vps-ip>
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
# only with 1 GB RAM:
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 4. Code and settings
```bash
git clone https://github.com/Stella112/kittora.git && cd kittora/deploy/vps
cp env.example .env                     # DOMAIN=kittora.xyz, VITE_NIM_VALIDATOR (Maris's pick, may stay empty)
cp relayer.env.example relayer.env && chmod 600 relayer.env
nano relayer.env                        # fill RELAYER_PRIVATE_KEY, ATTESTER_PRIVATE_KEY, SESSION_SECRET
```
`openssl rand -hex 32` makes a `SESSION_SECRET`. Everything else in `relayer.env` is pre-filled (mainnet addresses,
`DEPLOY_BLOCK=96840641`, RPCs).

## 5. Start
```bash
docker compose up -d --build            # first build takes a few minutes
docker compose logs -f relayer          # expect "kittora relayer up" with db "sqlite"
curl https://api.kittora.xyz/health     # {"ok":true,"relayer":"0xb6F9…",…}
```
- `ok:false` means the hot wallet is below 0.5 POL (`MIN_POL_WEI`): top it up.
- Open `https://kittora.xyz` in a desktop browser: it should show **Open Kittora in Nimiq Pay**. That is the expected
  screen outside Nimiq Pay.
- If HTTPS fails, `docker compose logs web` shows Caddy's certificate attempts (usually DNS not pointing here yet).

## 6. Smoke test on a phone (Nimiq Pay)
Open `https://nimpay.app/miniapps/open/kittora.xyz` on the phone, then:
1. Sign in (Nimiq signature) → Connect Polygon.
2. Save → Flex → deposit 1 USDT → Activity shows it with a Polygonscan link.
3. Groups → Start a group (hourly pilot) → share the invite → a second phone joins → both buy 1 share.
4. Relayer `/health`: POL went down a little; the users' POL stayed at 0.

Record each check in the BUILD_LOG.md test matrix (device, OS, Nimiq Pay version, result).

## Day-2
- **Update:** `cd kittora && git pull && cd deploy/vps && docker compose up -d --build`
- **Logs:** `docker compose logs -f relayer` (low-POL alerts appear as `ALERT relayer hot wallet POL low`)
- **Restart:** `docker compose restart relayer`
- **Backup the ops DB (optional):** `docker compose cp relayer:/data/relayer.db ./relayer-$(date +%F).db`
  It only holds rate-limit hits, relay records, Autosave run keys and forfeit records. Balances are always read
  from the contracts, so losing it never loses money.
- Keep the `caddy-data` volume: it holds the certificates (Let's Encrypt rate-limits re-issuing).

## Settings reference (`relayer.env`)
| Variable | Value |
|---|---|
| `POLYGON_RPC_URL` | Polygon RPC with receipts + logs. `https://polygon.drpc.org` works, but its free plan serves `eth_getLogs` only ~100 blocks per call (its error message wrongly says 10000). The indexer adapts: catch-up from `DEPLOY_BLOCK` takes ~1.5 s per 60 blocks and each read waits ~2 s. A keyed RPC with larger log ranges makes reads faster. |
| `RELAYER_PRIVATE_KEY` | **Secret.** Hot wallet `0xb6F9…e962` (POL for gas only). |
| `ATTESTER_PRIVATE_KEY` | **Secret.** Attester `0xa592…8a12`. Empty disables the NIM SafeLock watcher. |
| `SESSION_SECRET` | **Secret.** 32+ random characters. Without it, sign-ins reset on every restart. |
| `VAULT_ADDRESS`, `GROUP_KITTY_ADDRESS`, `DEPLOY_BLOCK`, `CHAIN_ID` | Pre-filled for Polygon mainnet. |
| `NIMIQ_RPC_URL` | Mainnet `https://rpc.nimiqwatch.com` (testnet RPC only for a testnet pilot). |
| `MIN_POL_WEI` | Optional low-balance alert threshold, default 0.5 POL. |
| `LOG_CHUNK`, `INDEX_WAIT_MS` | Optional indexer tuning: starting `eth_getLogs` span (9000, shrinks on refusal) and the longest a read waits for catch-up (5000 ms). |

`DB_PATH` and `PORT` are set by `docker-compose.yml`.

## Shared server where nginx already owns 80/443 (production: 56.125.248.192)
The production VPS also hosts other sites behind nginx (port 80 through a stream multiplexer to `127.0.0.1:8080`,
certificates from certbot's webroot `/var/www/firstbell-acme`, renewed by `firstbell-cert-renew.timer`).
Kittora is added without touching them:
1. Containers on localhost only:
   `docker compose -f docker-compose.yml -f docker-compose.behind-nginx.yml up -d --build`
   (app on `127.0.0.1:8280`, relayer on `127.0.0.1:8788`).
2. nginx stage 1: copy `deploy/vps/nginx/kittora-http.conf` to `/etc/nginx/sites-available/kittora`, link it into
   `sites-enabled`, `nginx -t`, reload. It only answers for the kittora.xyz names.
3. After DNS points at the server:
   `sudo /opt/firstbell-certbot/bin/certbot certonly --webroot -w /var/www/firstbell-acme --cert-name kittora -d kittora.xyz -d www.kittora.xyz -d api.kittora.xyz --deploy-hook "systemctl reload nginx"`
   The existing renewal timer then renews it with the others.
4. nginx stage 2: replace the site with `deploy/vps/nginx/kittora.conf`, `nginx -t`, reload.

## Alternative: managed hosting (Vercel + Railway + Neon)
Still supported, but no longer the main path:
- Relayer on Railway via the root `railway.json` (Dockerfile `apps/relayer/Dockerfile`, 1 replica, `/health`).
  Use the same variables as above, plus `DATABASE_URL` (Neon pooled string, `sslmode=require`) because Railway disks
  are not persistent without a volume.
- Mini app on Vercel with Root Directory `apps/web` (`apps/web/vercel.json`). Set `VITE_RELAYER_URL`,
  `VITE_PUBLIC_URL`, `VITE_VAULT_ADDRESS`, `VITE_GROUP_KITTY_ADDRESS`, `VITE_CHAIN_ID=137` and `VITE_NIM_VALIDATOR`.

## Local equivalents
- Everything on a fork: `pnpm --filter @kittora/relayer devnet`, then the `web-devnet` launch config (BUILD_LOG.md, Phase 5).
- Relayer against Postgres: `DATABASE_URL=postgresql://… pnpm --filter @kittora/relayer dev`

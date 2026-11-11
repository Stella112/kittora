# Build log

## Nov 5–6 2026: Phase 0 (spike) started, in parallel with Phase 1

**Built**
- Monorepo skeleton (pnpm workspaces), MIT LICENSE, `.env.example`, `packages/core/src/brand.ts`.
- Verified the brief's §1A facts against Nimiq Pay source `2115a8d` (see SOURCES.md).
- `apps/spike`: Vite page (S1–S5, S7) and a node verify/relay server. SDK pinned to 0.2.5.
- Foundry with OZ 5.7.0 and the Aave address book.

**Evidence**
- S6 PASS (fork): `forge test --match-path test/spike/AaveFork.t.sol`, 10e6 → 10029313 after 30 days, full withdraw.
- S5 PASS (fork): `apps/spike/contracts` 2/2 tests; user POL balance 0 throughout; replay rejected; cap enforced.
- S1 and S4 server verification PASS with local test keys; S1 challenge replay rejected.

**Open**
- Device runs S1–S5, S7 (Maris). S5 mainnet needs a funded relayer and approval of the SpikeVault deploy.

**Next**: PocketVault + GroupKitty (Phase 1).

## Test matrix
| Date | Device | OS | Nimiq Pay | SDK | Check | Result |
|---|---|---|---|---|---|---|

## Nov 6 2026: Phase 1 contracts (Gate 1 evidence)
**Built:** `SigAuth` (EIP-712 + nonces + deadline), `PocketVault` (Flex/Target/SafeLock/Bond pockets on Aave V3, Autosave mandates, NIM bonds, pilot caps), `GroupKitty` (VSLA: shares, social fund, guarantor loans, defaults, grants, Share-Out with roll-over), `script/Deploy.s.sol`, `setup-libs.sh`.

**Evidence**
- `forge test`: 47 tests green on a Polygon mainnet fork @ 96,810,000: PocketVault 25, GroupKitty 21, S6 spike 1, plus 2 invariant suites.
- Invariants: GroupKitty 256 runs × 500 calls (mock token, labelled TEST MOCK): balance ≥ cash + social, shares add up, a default never hurts non-guarantors, Share-Out pays exactly the balance. PocketVault (fork) 16 × 20: Σ pocket assets ≤ total assets.
- Coverage (`forge coverage --ir-minimum`): GroupKitty **99.7% lines**, PocketVault **98.8% lines**, SigAuth 100%.
- Slither 0.11.6 run; findings triaged in RISKS.md, with one fix (Aave withdraw return checked).
- Deploy script simulated on a fork (no broadcast).

**Not done / open**
- Polygonscan verification will happen at the real deploy (needs `POLYGONSCAN_API_KEY` and Maris's approval).
- `NoLiquidity` on loans is unreachable by construction (RISKS.md), so that branch is uncovered.

**Next:** Phase 2 (relayer, scheduler, watcher, attester).

## Nov 6 2026: Phase 2 (relayer, scheduler, watcher, attester)
**Built:** `packages/core` (generated ABIs, EIP-712 builders, Nimiq link message); `apps/relayer` (Hono):
- action whitelist and policy pipeline (deadline → nonce → signature → rate limit → simulate → gas cap)
- serialized nonce queue, resynced from the chain's pending count before every send, with one retry on a nonce conflict
- `/relay`, `/status/:hash`, and `/health` with a low-POL alert
- Autosave scheduler (idempotency key per mandate run)
- NIM watcher + attester: forfeits only on the explicit "No staker" reply or stake below the bond, never on an RPC error

**Evidence:** `pnpm --filter @kittora/relayer test` against an anvil Polygon fork with the real contracts deployed by `Deploy.s.sol`: **14/14 pass, two consecutive full runs**.
- Gasless happy path: user holds 0 POL; `tx.from` = relayer.
- Rejections, one test each: unknown action, bad params, forged signature, expired, replayed, foreign spender, simulation revert, gas cap, rate limit.
- 5 concurrent relays get distinct nonces and all confirm.
- Scheduler: a run is never re-sent while pending or after a restart; it runs again after the interval; revoke stops it.
- Bond: link checks (bad link, stake missing), then the watcher forfeit emits the Nimiq tx hash, and there is no second attempt. Uses a labelled TEST MOCK Nimiq RPC.
- Live Nimiq testnet RPC read of a real staker.

**Fixed while testing:** two relayer instances sharing one key could collide on nonces. The sender now resyncs from the chain before each send.

**Open:**
- Live testnet early-unstake run needs the phone (after S2).
- Production Postgres driver not wired yet (local uses node:sqlite via Drizzle sqlite-proxy).

**Next:** Phase 3 (mini app shell).

## Nov 6 2026: Phase 3 (mini app shell)
**Built:** `apps/web` (Vite 7, React 19, React Router 7, TanStack Query 5, Tailwind 4):
- host detection, then an "Open in Nimiq Pay" screen with both verified deeplinks when outside Nimiq Pay
- Nimiq sign-in (listAccounts + sign; relayer `/auth/challenge` + `/auth/verify`, HMAC session token)
- Polygon connect through the host provider (never passes rpcUrl)
- one error vocabulary covering every §4.1 item 5 case, each with a retry path
- disclosure screen gating the first deposit (variable yield, contract risk, pilot caps, NIM bond rule with attester trust, default rule, relay)
- Home with My Kitty total, group share, next meeting / Share-Out countdown, and Save + Join buttons; bottom nav; TESTNET badge from `getHostNetwork()`
- Relayer: `/me/:evm` read index (event scan from `DEPLOY_BLOCK` in 9k-block chunks; values always read live)

**Evidence:** typecheck clean; `vite build` passes (main chunk 210 KB gzipped); web tests 14/14 (error classification); relayer auth tests 2/2 (valid, single-use, wrong address, tampered, expired, forged token). Browser preview at 360 px: outside-Nimiq-Pay screen and sign-in render with no errors.

**Open (needs device):**
- <3 s open on a mid-range phone.
- "Sign-in in one approval": `listAccounts` may itself prompt in Nimiq Pay, which would make it two. To confirm in S1.
- Home with real data needs deployed contracts.

Save/Groups/Activity tabs are labelled shells until Phases 4–5.

## Nov 6 2026: Phase 4 (My Kitty flows), built; device gate pending
**Built (`apps/web/src/screens/save`, `lib/chainActions.ts`, `components/TxFlow.tsx`):**
- **Approval screen** for every action: what you sign, amount, chain, "Network fee: covered by Kittora", and the number of Nimiq Pay prompts. Three states: pending (explorer link), confirmed, failed (reason + retry; "check status" for pending).
- **Flex / Target (named goal, progress bar) / SafeLock:** open + first deposit, deposit, withdraw (amount or all). SafeLock withdrawal is blocked in the UI with its unlock date before the date; the contract enforces it too.
- **Gasless approvals:** USDT meta-tx approve only when the allowance is short, approving current + amount so it doesn't overwrite an Autosave budget.
- **Autosave:** amount per run, interval (hourly pilot / daily / weekly / 30 days), runs. One approval of amount × runs, then create. Revoke stops it and resets the allowance to 0 (Maris item 5).
- **NIM SafeLock:** stake via `sendNewStakerTransaction` / `sendStakeTransaction` (skipped if the active stake already covers it), wait until the relayer sees the stake, Nimiq `sign()` of the link message, `LockBond` relayed with the link proof. Bond list with claim after `unlockAt + claimDelay`. Copy says "bonded, not a hard lock" plus the attester trust assumption.
- **Live Aave rate** shown as APR "variable, not guaranteed".
- **Relayer:** `/nimiq/staker/:address`.

**Evidence:** web typecheck + build pass; 23 web tests pass (amount parsing incl. NIM→Luna, ray→%, Nimiq address vs @nimiq/core, typed-data JSON round-trip as the host signs it for LockBond / CreateMandate / Withdraw(max) / RequestLoan(arrays) / USDT meta-tx, plus the error cases). The relayer integration suite (14/14) already proves the same messages are accepted on-chain.

**Gate 4 still open (device + deploy):** deposits / withdrawals inside Nimiq Pay on Polygon mainnet (≤1 USDT per action, after Maris approves the deploy); NIM SafeLock on testnet; Autosave twice + revoke on schedule. Unknown until S2: whether the staking SDK calls return a tx hash (the explorer link uses the returned value). `VITE_NIM_VALIDATOR` needs Maris's pick.

## Nov 6 2026: Polygon mainnet deploy (approved by Maris: "Yes, deploy")
| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| PocketVault | [0x7B1e1bAed045Db95b5F5b3E1e6E50efdac851251](https://polygonscan.com/address/0x7b1e1baed045db95b5f5b3e1e6e50efdac851251) | [0xf3d6263e…](https://polygonscan.com/tx/0xf3d6263ea60ccf5cdac4c91716c9ec35589f331bb27d85d86c8b159ac894afd4) | 96,840,641 |
| GroupKitty | [0x2271dA8756185B48A46A17051fF3A90d6481ed5f](https://polygonscan.com/address/0x2271da8756185b48a46a17051ff3a90d6481ed5f) | [0x069d24d4…](https://polygonscan.com/tx/0x069d24d40649394d8b8ef7f9fefd8c2b2b14c06b30002575dd6b38641445d719) | 96,840,642 |
| `setGroupKitty` wiring | | [0x27a2973a…](https://polygonscan.com/tx/0x27a2973a1fff1fbcba41133d6ecada5442ade13dc53a5d6add22d7638a821d72) | 96,840,643 |

- All three receipts have status 1. On-chain checks: `vault.groupKitty()` = GroupKitty, `gk.vault()` = PocketVault, `vault.attester()` = 0xa5924b26…8a12.
- Both contracts verified on Polygonscan ("Pass - Verified") and Sourcify.
- Constructor arguments: USDT0 `0xc213…8e8F`, aUSDT `0x6ab7…0620`, Aave Pool `0x794a…14aD` (all from the address book), burn `0x…dEaD`, claimDelay 3600 s.
- Cost: ~1.04 POL. Relayer/deployer `0xb6F9…e962` has 1.96 POL left; attester `0xa592…8a12` has 1 POL.
- `publicnode` refuses receipt/archive calls without a token, so the RPC was switched to `polygon.drpc.org`. A paid RPC key is still recommended for the pilot.

## Nov 6 2026: Phase 5 (Group Kitty + Activity), built; device gate pending
**Built (`apps/web/src/screens/groups`, `screens/Activity.tsx`, `lib/group.ts`, `lib/groupMath.ts`, `lib/activityFeed.ts`):**
- **Groups list**: my groups with live share value; start a group; join by group number or pasted invite link.
- **Start a group**: share price, social fund per meeting, meeting interval (hourly pilot / weekly / 2 weeks / 30 days), number of meetings, max shares per meeting, flat interest, loan multiple (1–3×), approvals, member cap (2–30), grace period. All validated against the contract's `BadParams` rules; the review lists every rule because they are immutable.
- **Invite**: Nimiq Pay universal link to `/groups/<id>?name=…` (share sheet or copy). The group name is local only (not on-chain) and travels in the link.
- **Group page**: header (my shares and value, pool, social fund, members, meeting n of N with countdown, current share value), **Save at this meeting** (1–5 shares + social fund once per meeting, pool-cap and balance checks, gasless approve), **group board** (shares per member over the last 4 meetings, missed marks, loan badges), **loans** (request with guarantors and pledges, live limit check mirroring `_checkLimit`; approve / guarantee; pay out; cancel; repay part or all, also by a guarantor; mark as defaulted after due + grace), **social fund** (request, approve; pays on the last approval), **Autosave into the group** (vault mandate `toGroup`, one run per meeting until Share-Out; stop + allowance reset), **Share-Out** (estimate, blocked while loans are open, claim to wallet or roll into a pocket), and the fixed group rules.
- **Disclosure gate** before any money action (buy, repay, guarantee, Autosave, Share-Out). Join and plain approvals do not move the signer's money.
- **Activity tab**: indexed contract events (one row per tx, plain words from the viewer's side, block time, Polygonscan link) merged with local pending / failed / Nimiq steps.
- **Clock**: meeting index, due dates, cycle end and countdowns use the latest block time, not the phone clock, and signed deadlines are `max(phone, chain) + 20 min` (relayer checks wall time, contract checks block time).
- **Unsigned relays** (pay out, mark default) say "Confirm (nothing to sign)" instead of asking for a Nimiq Pay signature.
- **Relayer:** the indexer now decodes every vault and group event and serves `/group/:id` (loan and grant ids; the contract cannot enumerate per group) and `/activity/:evm` (feed with tx hashes and block times; guarantors see the loans they back).
- **Local devnet** (`pnpm --filter @kittora/relayer devnet`, then the `web-devnet` launch config): anvil Polygon fork with `Deploy.s.sol`, relayer on :8789, three funded anvil dev accounts; `src/dev/devnetHost.ts` stands in for Nimiq Pay (`?as=0|1|2` switches member). It loads only in `--mode devnet`; the production bundle was grepped and contains none of it.

**Evidence**
- Relayer `pnpm test` on the anvil fork: **17/17** (new: full group cycle through `/relay` (create, 2 joins, 3 × buy, loan with a guarantor, approve, permissionless disburse, full repay, pledge released, grant request + approval paid), `/group/:id` lists the loan and grant, `/activity` newest-first with timestamps (guarantor included), Share-Out pays exactly 16.10 USDT in total (5.3667 each)).
- Web: typecheck + build pass; **30 tests** (new: group math vs the DECISIONS.md worked examples (1.04 share value, Bob's 20 USDT loan with Carol's pledge, 10.8 Share-Out), invite parsing, activity labels and feed merge).
- Clicked through in the browser on the devnet at 390 px as three members: create → join × 2 → buy 5 each → 8 USDT loan with a 3-share guarantee → guarantee → pay out → repay 8.80 → share value 1.05 → Share-Out 5.46 to wallet (= 15.80 × 5/15 + 0.60/3) → Activity rows. No console errors after reload.
- Fixed while testing: meeting number from the phone clock (wrong on a skewed chain); signed deadline behind block time (relay rejected; now chain-aware); "You pledges" copy.

**Open**
- Device gate: the same cycle inside Nimiq Pay on Polygon mainnet with real members (≤1 USDT per action).
- Group names are per device (and in the invite link), not on-chain.
- The board marks meetings before a member joined as missed (no join time on-chain).
- Group Autosave: a run in a meeting where the member already paid the social fund by hand reverts and retries each tick until the next meeting; if the social fund is a multiple of the share price it would buy extra shares instead. Prefer one method per group.
- Bundle: main JS chunk 187 KB gzipped in the final build. Open time on a mid-range phone (<3 s) is still a device check.

## Nov 6 2026: deploy readiness (Postgres, hosting configs, runbook)
**Built**
- **Postgres for the relayer** (Neon, DECISIONS.md item 14): set `DATABASE_URL` and the same Drizzle schema and queries run on Postgres through the sqlite-proxy driver (`?` placeholders numbered for Postgres, int8 read as numbers). Without it, local SQLite as before. The relayer exits at start with `database not reachable` if the URL is wrong.
- **Hosting configs**: `apps/relayer/Dockerfile` (Node 24, production-only filtered install from the lockfile, runs TypeScript with type stripping), root `railway.json` (Dockerfile, 1 replica, `/health` check), `.dockerignore`, `apps/web/vercel.json` (filtered install, SPA rewrite so invite links like `/groups/3` load, long cache for hashed assets).
- **Indexer on free RPC plans**: the `eth_getLogs` span halves whenever the provider rejects a range (drpc free ≈ 100 blocks, though its error says 10000), reads wait at most `INDEX_WAIT_MS` (5 s) and then answer with what is indexed so far, and a background loop keeps the index warm.
- **Runbook** `docs/DEPLOY.md` (Neon → Railway → Vercel → phone smoke test, every variable, mainnet addresses) and a **submission draft** `submission/SUBMISSION.md` (form fields with TODOs only the team can fill).

**Evidence**
- Relayer tests: Postgres backend via PGlite (real Postgres in WASM, test only) runs the same queries as SQLite: rate-limit count, relay record, Autosave idempotency key with conflict ignored, forfeit uniqueness (9 tests on both backends); indexer range shrinking, bounded wait, and real errors still thrown (3 tests, mocked RPC labelled TEST MOCK).
- Dockerfile steps replayed without Docker (not installed here): clean copy of the same files, `pnpm install --frozen-lockfile --prod --filter @kittora/relayer...`, then the start command. Against **Polygon mainnet** (read-only, anvil's public test key with 0 POL): `/health` 200 with the low-POL alert firing; a bad `DATABASE_URL` exits 1 with the clear message; the index caught up from block 96,840,641 in the background while `/group/1` answered in 5 s, then ~2 s once caught up; no errors logged.

**Open**
- The image itself was not built (no Docker here): Railway's first build is the real test.
- The actual Neon / Railway / Vercel setup needs the team's accounts and secrets (DEPLOY.md).

## Nov 6 2026: VPS hosting (main path) on the team's domain
Hosting moved from Vercel + Railway + Neon to **one VPS** on **kittora.xyz** (team decision: avoid paid-tier limits; domain confirmed).
The managed configs stay as a documented alternative.

**Built (`deploy/vps/`)**
- `docker-compose.yml`: `relayer` (existing Dockerfile; SQLite on the `relayer-data` volume; only reachable through Caddy) and `web` (Caddy on 80/443 with automatic Let's Encrypt; certificates on the `caddy-data` volume).
- `web.Dockerfile`: builds the mini app with `VITE_RELAYER_URL=https://api.$DOMAIN`, `VITE_PUBLIC_URL=https://$DOMAIN` and the mainnet addresses, then serves it from Caddy.
- `Caddyfile`: `$DOMAIN` (SPA fallback for invite links, immutable asset caching), `www.` → root, `api.` → relayer. Caddy ignores client-sent `X-Forwarded-For`, so the relayer's per-IP rate limit sees the real client.
- `env.example` (DOMAIN, validator) and `relayer.env.example` (pre-filled mainnet settings; the three secrets are filled on the server only). `relayer.env` is git-ignored and excluded from every Docker build context.
- `docs/DEPLOY.md` rewritten: VPS, DNS records, server setup, start, smoke test, day-2 (update, logs, backup).

**Evidence**
- Web image build steps replayed in a clean copy (filtered install from the lockfile, production env, `DOMAIN=kittora.xyz`): build passes; the bundle contains `https://api.kittora.xyz` and the vault address, and no `localhost:8788` or devnet code. Local `.env*` files are excluded from the build context.
- Image tags checked on Docker Hub: `node:24-slim`, `caddy:2.10.2-alpine`.
- The relayer image steps were already replayed against mainnet (entry above).

**Open**
- Docker is not installed here: the first `docker compose up --build` on the VPS is the real build test.
- `main` must be pushed before the VPS can clone it.

## Nov 6 2026: live at https://kittora.xyz
Deployed on the team's existing AWS Lightsail VPS (56.125.248.192, Ubuntu 24.04), shared with other sites behind its nginx; nothing of theirs was changed.
- `~/kittora` (git clone of `main`), `docker compose -f docker-compose.yml -f docker-compose.behind-nginx.yml`: web on 127.0.0.1:8280, relayer on 127.0.0.1:8788 (SQLite volume).
- nginx site `kittora` (only the kittora.xyz names), checked with `nginx -t` and reloaded gracefully; keepflow.site checked 200 before and after.
- Let's Encrypt certificate `kittora` (kittora.xyz, www, api) via the server's existing certbot webroot, renewed by its existing timer with an nginx reload hook. Valid to Feb 4 2027.
- DNS at Namecheap: A records `@`, `api`, `www` → 56.125.248.192 (seen on 1.1.1.1 and 8.8.8.8).
- Keys entered by the team directly on the server; checked only for format (0x + 64 hex) and by the addresses the relayer reports.

**Evidence (from the internet):** `https://kittora.xyz` 200 with a valid certificate; `/groups/3` 200 (SPA fallback); `http://` and `www.` → 308 to `https://kittora.xyz`; `https://api.kittora.xyz/health` `ok:true`, relayer `0xb6F9…e962` with 1.96 POL, attester `0xa592…8a12` with 1 POL, scheduler and watcher ticking; `/auth/challenge` 200; index caught up to block 96,849,880; unknown relay actions rejected.

**Open:** the phone smoke test inside Nimiq Pay (`https://nimpay.app/miniapps/open/kittora.xyz`); `VITE_NIM_VALIDATOR` (Maris's pick) then a rebuild of the web image.

## Nov 7 2026: Addendum A1 (Group Accounts), built and tested; redeploy pending
Code is on branch `a1` (commit d7d6900); `main` and kittora.xyz still run the pre-A1 contracts.

**A1.1 Group profile:** name / purpose / cover set at creation, editable by the Admin; `GroupProfileUpdated`; header and list show the cover and name as plain text.
- Gate (Foundry): `test_A1_1_createWithProfile`, `_adminEditsOthersCannot`, `_lengthAndCoverLimits`, `_relayedProfileSignature` pass.
- Open: phone check and the Nimiq stamp (see below).

**A1.2 Activity feed v2:** relayer `/group/:id/feed` + `/group/:id` (initiator, approvers, relay tracking); feed with All / Money in / Loans / Approvals filters; "needs you" approvals pinned with Approve; empty state.
- Evidence: web `groupFeed.test.ts` passes.
- Open: the "Stamped on Nimiq" status (stamps not built); phone check; relayer restart rebuild on the live server.

**A1.3 Recurring group contributions:** "Contribute every meeting" mandate; one attempt per mandate per window (`mandate_windows`); contract rejects a second contribution in a window; "Missed contribution" notice; Members tab.
- Gate (Foundry): `test_A1_3_twoConsecutiveWindows`, `_manualPurchaseSkipsWindowNoDoubleBuy`, `_secondRunInSameWindowReverts`, `_insufficientBalanceRunReverts` pass.

**A1.4 Roles:** Admin (transferable), 0–2 Treasurers, Members; remove only members with no shares, loans or pledges; `RoleChanged`.
- Gate (Foundry): `test_A1_4_onlyAdminAssignsRoles`, `_transferAdmin`, `_removeOnlyEmptyMembers`, `_rolesNeverMoveMoney`, plus fuzz `invariant_rolesNeverMoveMoney` and `invariant_roleBookkeeping`, pass.

**A1.5 Social fund payments:** propose / approve / execute with cap, member-only recipient, 7-day expiry (capped at cycle end); replaces grants.
- Gate (Foundry): `test_A1_5_capAndRecipientRules`, `_proposerAndRecipientApprovalsDontCount`, `_needsTreasurerOrAdminWhenNoTreasurer`, `_expiredCannotApproveOrExecute`, `_expiryNeverPassesCycleEnd`, `_mainPoolUntouched`, `_relayedProposeSignature` pass.

**Regression:** full suite green (PocketVault 25, GroupKitty 21 incl. full loan → repay → Share-Out cycle, GroupKittyA1 19, invariants incl. role fuzz, S6); web 37/37; relayer typed + auth 5/5.

**Slither 0.11.6** on the A1 GroupKitty: 19 GroupKitty findings in three known categories (12 block.timestamp, 6 zero-initialised locals, 1 arbitrary-from in `repay`), all triaged as by-design in RISKS.md. No new category.

**Open:**
1. **Nimiq stamps are not implemented anywhere** (main brief §4.1 item 3 and A1). This blocks the "Stamped on Nimiq" status and the phone gates.
2. Batched redeploy of both contracts (needs Maris's approval). Mainnet check Nov 7: `groupCount() = 0`, `pocketCount() = 0`, `totalAssets() = 0`.
3. Phone gates inside Nimiq Pay.
4. README (does not exist yet; its trust section must mention roles and payouts).

**Next:** redeploy simulation, then Nimiq stamps.

## Nov 7 2026: Nimiq stamps (main brief §4.1 item 3 + A1)
**Built:**
- `packages/core/src/stamp.ts`: encode/decode, ≤64 bytes.
- Relayer: `POST /stamps` verification (`src/stamps.ts`), `stamps` table (SQLite + Postgres), stamps attached to `/group/:id/feed` and `/activity/:evm`.
- App: optional stamp step after every confirmed group action, in Group and NewGroup flows.
- Feed status "Stamped on Nimiq" with a Nimiq link.

**Evidence:**
- relayer `stamps.test.ts` 6/6 (all 17 actions round-trip within 64 bytes incl. a 12-digit group id; stamped, idempotent, pending ×2, rejected ×6 cases)
- web 39/39 incl. stamp status tests; both typecheck; web build passes.

**Open:**
- Phone check that Nimiq Pay sends a 1-Luna self-payment with the memo and the relayer verifies it on mainnet.
- Scheduler Autosave runs are unstamped (see DECISIONS).

## Nov 7 2026: A1 redeploy to Polygon mainnet (approved by Maris: "Sent, redeploy")
Checked first (Addendum §5): the first deployment held **0 groups, 0 pockets, 0 USDT**, so no real funds were stranded.

| Contract | Address | Tx | Block |
|---|---|---|---|
| PocketVault | [0x2583FE752256afB1F863a2D5EEea5241BD2B4bDb](https://polygonscan.com/address/0x2583fe752256afb1f863a2d5eeea5241bd2b4bdb) | [0x9e03d4b0…](https://polygonscan.com/tx/0x9e03d4b0075b85867fbdb072690cfcb6bb52b90a74dffb816c022f33cace19e8) | 96,904,101 |
| GroupKitty (A1) | [0x19d8687607fD86A25F8e80a535e5A9c6A848A4a7](https://polygonscan.com/address/0x19d8687607fd86a25f8e80a535e5a9c6a848a4a7) | [0x570b924b…](https://polygonscan.com/tx/0x570b924bc55a5ebb77316495e257ee9aa683f57e49df7efc697f3d2a80541fed) | 96,904,104 |
| `setGroupKitty` | | [0xcca05c2d…](https://polygonscan.com/tx/0xcca05c2d95b346e97f639a25dd6224675e5d20e1f126afbfb392248ef038bfc8) | 96,904,106 |

- All three receipts have status 1. `vault.groupKitty()` = new GroupKitty; `gk.vault()` = new PocketVault; attester `0xa592…8a12`; `PAYOUT_TTL` 604800; `COVER_COUNT` 8.
- Verified on Polygonscan (GroupKitty "Pass - Verified"; PocketVault already matched as verified source).
- Cost 2.36 POL at a 320 gwei cap. Deployer/relayer has 2.60 POL left.
- First attempt via the Tenderly gateway was refused before sending ("tx fee exceeds the configured cap (1.00 ether)", a per-tx cap on that gateway). Nothing was sent: nonce still 3. Broadcast via `polygon.drpc.org` instead.
- The old contracts (0x7B1e…1251 / 0x2271…ed5f) are retired and empty.
- Updated: local relayer `.env`, `apps/web/.env.local`, `deploy/vps/web.Dockerfile`, `deploy/vps/relayer.env.example`, `submission/SUBMISSION.md`.

**Not yet done:** kittora.xyz still serves the old build and points at the old contracts. Shipping needs `a1` merged to `main`, the server's `relayer.env` updated (addresses + `DEPLOY_BLOCK=96904101`) and the images rebuilt.

## Nov 7 2026: A1 shipped to https://kittora.xyz (approved by Maris: "Yes, ship it")
- `a1` fast-forwarded into `main` (7221658) and pushed.
- Server: `relayer.env` backed up to `relayer.env.bak-pre-a1`; only `VAULT_ADDRESS`, `GROUP_KITTY_ADDRESS`, `DEPLOY_BLOCK=96904101` changed (secrets not read). `git pull`, then rebuilt the `kittora-web` and `kittora-relayer` containers. nginx untouched.

**Evidence (from the internet):**
- `https://kittora.xyz` 200; its JS bundle contains the new vault address and not the old one.
- `api.kittora.xyz/health` ok, relayer 2.60 POL, attester 1 POL.
- Index scanning from the new deploy block (96,904,4xx); `/group/1/feed` empty (no groups yet).
- `POST /stamps` live (rejects bad input).
- 0 error logs since restart.
- keepflow.site still 200.

**Next:** phone gates inside Nimiq Pay (A1.1–A1.5 + stamps + Gate 4/5 flows); top up the relayer wallet to ~5 POL before the pilot.

## Nov 10 2026: closing two known gaps
- **Members tab counts the whole history.** The relayer's `/group/:id` now returns `memberStats` (meetings each member bought shares in, from every indexed event, plus their latest join time); the Members tab uses it instead of the 200-event feed page. Test: 250 purchases counted while the feed page stays at 200.
- **Autosave runs can be stamped.** New stamp code `ar` (`mandate.run`). Autosave purchases happen while the member is away, so the group page now offers "Stamp your Autosave runs" for the member's unstamped runs (1 Luna to themselves each, one Nimiq Pay approval each, optional). The relayer verifies them like any stamp (the run's tx carries PocketVault + GroupKitty logs). No Kittora Nimiq key was added.
- Evidence: relayer 39/39 (fork suite incl. the A1 group cycle; stamps round-trip all 18 codes), web 39/39, both typecheck.
- Open: the stamp button needs the phone check (the devnet stand-in has no Nimiq side).

## Nov 11 2026: phone test inside Nimiq Pay, passed (reported by Maris)
Live at https://kittora.xyz (eb614cf) on Polygon mainnet, tested by Maris on her phone inside Nimiq Pay: "all tested and working".
- Seen on mainnet during the test: pockets #1 Flex (deposited, then withdrawn), #2 NIM SafeLock bond 0.20 USDT, #3 Target 0.10, #4 SafeLock 0.10, #5 Flex 1.00, all owned by the tester's Polygon account (read from PocketVault 0x2583…4bDb).
- Fixed during the test (all deployed): wallet USDT + NIM balances on Home/Save; Withdraw button and sheet; tappable pocket cards; NIM balance falls back to the relayer's Nimiq RPC while Nimiq Pay is still syncing; Auto / Light / Dark theme switch; Home and Save read pockets, bonds, Autosaves and groups straight from the contracts so balances never depend on the relayer index (which rebuilds after a restart).
- Test matrix details (device, OS, Nimiq Pay version, per-flow results) to be filled in by Maris.

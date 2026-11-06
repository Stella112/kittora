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

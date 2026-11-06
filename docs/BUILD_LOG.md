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

## Nov 6 2026: Phase 2 (in progress)
**Built:** `packages/core` (generated ABIs, EIP-712 builders, Nimiq link message); `apps/relayer` (Hono): action whitelist, policy pipeline (deadline → nonce → signature → rate limit → simulate → gas cap → serialized nonce queue), `/relay`, `/status/:hash`, `/health` with low-POL alert, Autosave scheduler (idempotency key per mandate run), NIM watcher + attester (forfeits only on the explicit "No staker" reply or stake below the bond; never on an RPC error).
**Evidence:** `pnpm --filter @kittora/relayer test` against an anvil Polygon fork with real deployed contracts. 12 of 14 pass: gasless happy path (user 0 POL, `tx.from` = relayer), and rejections for unknown action, bad params, forged, expired, replayed, foreign spender, simulation revert, gas cap and rate limit; bond link checks plus watcher forfeit emitting the Nimiq tx hash; live testnet RPC read.
**Open:** 2 tests time out at 180 s (concurrent joins; scheduler restart). Likely the waits for receipts on the anvil fork, not yet diagnosed. Live testnet early-unstake run needs the phone (S2). Production Postgres driver not wired yet.

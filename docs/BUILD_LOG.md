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

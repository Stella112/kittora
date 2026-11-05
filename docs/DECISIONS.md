# Decisions

## Nov 5 2026: Maris answers to the Phase 0 questions (verbatim summary)
1. Timeline re-baselined to Nov 5; Phase 0 and Phase 1 in parallel. Nov 6 spike + contracts; Nov 7 Gate 1 + relayer; Nov 8 shell + My Kitty; Nov 9 Group Kitty + mainnet deploy (after approval); Nov 10 pilot; Nov 11 submit by 20:00 UTC. Report slips the same evening.
2. Maris runs device checks from a numbered checklist (`docs/SPIKE.md`).
3. SpikeVault approved; lives only in `apps/spike`, throwaway.
4. S5 on Polygon mainnet, real USDT, **5 USDT cap**, fork test first. Maris funds the relayer with POL. "We are building on mainnet directly."
5. Autosave: one meta-tx approval of `amountPerRun × maxRuns` at creation; revoke resets approval to 0; contract enforces per-mandate caps.
6. One relayed transaction per approval (own stamp + receipt).
7. Amounts above own shares must be covered by guarantor pledges.
8. Share value = current pool value per share excluding the social fund. Formula plus worked example to be written here in Phase 1.
9. Leftover social fund: carried forward if a new cycle starts, otherwise split equally per member.
10. `PocketVault.depositFor` callable only by the GroupKitty address set at deployment.
11. Contract-enforced immutable pilot caps: 25 USDT per deposit, 100 USDT per user across pockets, 500 USDT per group pool.
12. The Nimiq link signature covers the EVM address, lock ID, chain ID and vault address; the vault stores its hash.
13. Early unstake is judged by **state**: forfeit if active stake < bonded amount before the unlock date; switching validators is allowed.
14. Name stays Kittora; relayer is sponsored; validator chosen by Maris from the top 3 in the validators API; bond with no group goes to `0x…dEaD`; hosting is Vercel + Railway + Neon; no ₦ estimate.
15. Repo `github.com/Stella112/kittora`, public.

## Engineering decisions (within the rules)
- **Relayer calls `executeMetaTransaction` directly** rather than going through OpenGSN like Nimiq Pay does. The user-signed message is identical to Nimiq Pay's; only the submitter differs. Fork-proven in S5.
- **Token name is read on-chain** (`name()` is currently "USDT0") when building the meta-tx domain, never hard-coded, mirroring `resolveTokenMetaTxDomain`.
- **Windows checkout of `aave-v3-origin`:** its repo contains `certora/**/aux/*` paths that Windows can't create. Only `src/` is extracted (via `git archive`) under `lib/aave-address-book/lib/aave-v3-origin`. Fresh clones on Windows must repeat this; a setup script follows in Phase 1.
- Solidity 0.8.28, EVM `cancun` (Polygon PoS supports it), optimizer 200 runs.

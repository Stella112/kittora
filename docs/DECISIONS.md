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

## Nov 6 2026: Phase 1 contract decisions

### Share value (Maris item 8), exact formula
`valueOfShares(n) = n × (cash + outstandingPrincipal) / totalShares` (USDT, 6 dp), where `cash` is loanable pool USDT and the **social fund is excluded**. With no shares yet, value = `n × sharePrice`.
Loans count at par (principal) until repaid or written off; unpaid interest is not counted until it is paid.

**Worked example** (test `test_fullCycle_loanRepayShareOutWithProfit`): 5 members × 10 shares at 1 USDT gives cash 50, S 50, value 1.00/share, social fund 2.0.
- Bob borrows 20 (own 10 + Carol pledges 10): cash 30, outstanding 20, value still 1.00.
- Bob repays 22 (2 interest): cash 52, outstanding 0, value 1.04/share.
- Share-Out per member: 52 × 10/50 + 2.0/5 = **10.8 USDT**, against 10.4 paid in (0.4 profit each).

**Default example** (test `test_defaultCutsBorrowerThenGuarantor_othersUntouched`): V 50, S 50; Bob owes principal 15 and defaults.
- Burn `ceil(15 × 50/50) = 15` shares: Bob's 10 unpledged, then 5 of Carol's pledged.
- Then V 35, S 35: still 1.00/share for everyone else.

### Other choices made within the rules
- **Interest** is a flat `interestBps` of principal per loan, fixed at request. Repayments pay **interest first**, then principal.
- **Grace period** is a group parameter (`gracePeriod`) fixed at creation. The brief says "due date + grace" without a value, so it is chosen per group.
- **Loan multiple** is stored in basis points (`maxLoanMultipleBps`, 30000 = 3×) to allow fractional multiples.
- **One open loan per member.** A member with an open (requested or disbursed) loan cannot pledge. A member's own loan limit counts only their unpledged shares. Together these guarantee the borrower-first cut is always covered.
- **Pledges freeze when the guarantor approves**, not at request. Disbursement re-checks the limit at the current share value.
- **Social fund grants** need `approvalsRequired` approvals from members other than the requester, and pay automatically on the last approval.
- **New cycles are not built** (not in the §4.1 scope). Per Maris item 9, the leftover social fund is therefore split **equally per member** at Share-Out. Carry-forward is noted in IDEAS.md.
- **Share-Out rounding dust goes to the last claimer**, so the contract ends at exactly 0 (tested and fuzzed).
- **Wiring order:** `PocketVault.setGroupKitty` is callable once, by the deployer only, then frozen. This counts as "set at deployment" (Maris item 10); the deploy script does it in the same broadcast.
- **Bond claim window:** `claimDelay` (default 1 h) after `unlockAt`, during which the attester may still forfeit. Claims open after it, which covers watcher latency for a last-minute unstake.
- **Bond yield:** a bond sits in its own Bond-kind pocket and earns Aave yield. Claim returns principal plus yield; forfeit moves all of it.
- **Direct calls:** every signed function also accepts a direct call from the signer with an empty signature (nonce and deadline still apply), which is useful for wallets that hold POL.
- **Autosave into a group:** `amountPerRun` must equal `shares × sharePrice + social fund due this meeting`, otherwise the run reverts.
- **RPC for fork tests:** `https://polygon.drpc.org` (archive state), pinned block 96,810,000.

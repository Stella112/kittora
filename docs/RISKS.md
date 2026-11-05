# Risks and review findings

## Trust assumptions
- **Attester key** (`PocketVault.attester`, immutable) can forfeit an active NIM bond until `unlockAt + claimDelay`. It cannot touch any other pocket. Each forfeit emits the Nimiq tx hash as public evidence. A dishonest attester could forfeit an honest user's bond, so this is a documented trust assumption (README and disclosure screen).
- **Relayer** pays gas and submits signed requests. It cannot move funds without a user signature; at worst it censors requests or delays them. Signatures bind owner, amounts, nonce and deadline.
- **Deployer** wires `groupKitty` exactly once, then has no powers. There is no admin, no pause and no upgrade.
- **Aave V3** smart-contract and liquidity risk: withdrawals can fail if Aave's USDT pool is fully utilised. Yield is variable.

## Gate 1 review (Nov 6 2026)
Tools: Slither 0.11.6 (`python -m slither . --filter-paths "lib/|test/|script/" --exclude-informational --exclude-optimization`), forge lint, manual review.

| Finding | Where | Triage |
|---|---|---|
| arbitrary `from` in transferFrom | `GroupKitty.repay` (payer), `PocketVault.executeMandate` (m.owner), `_deposit` | **By design.** `payer`/owner is authenticated by `_auth` (EIP-712 or direct call); mandates are signed by the owner and limited by interval, maxRuns, expiry and allowance. |
| reentrancy (events after external call) | `_withdraw`, `forfeitBond`, `claimShareOut` | All external entry points are `nonReentrant`; state is written before calls (CEI); external callees are Aave Pool, USDT, and our own GroupKitty/PocketVault. Accepted. |
| strict equality | `shares == 0`, `amount == 0` guards | Intended zero guards. |
| block.timestamp | locks, meetings, due dates, deadlines | Intended; minute-level miner skew does not matter at day-scale intervals. |
| uninitialised locals | accumulators | Intentional zero init. |
| ignored tryRecover return | `SigAuth._auth` | The third value (error arg) is not needed; err and signer are both checked. |
| unchecked Aave withdraw return (forge lint) | `_withdraw` | **Fixed**: now reverts if Aave returns a different amount. |

## Design notes
- **Loan `NoLiquidity` is unreachable by construction.** Value per share is (cash + outstanding)/S, each loan's cover (own unpledged + pledged value) is ≥ its principal, and cover can't be counted twice (a borrower can't pledge, and pledges are frozen). So the sum of principals ≤ pool value, and a new loan ≤ cash. The check stays as defence in depth. Grant `NoLiquidity` is reachable and tested.
- **Default rounding** burns `ceil(L·S/V)` shares; guarantor cuts are `ceil` pro rata and capped at each pledge, so the total burned is ≥ the exact amount and outsiders never lose. Fuzzed in `invariant_defaultNeverHurtsOutsiders`.
- **Inflation/donation:** 10^6 virtual shares offset in PocketVault.
- **Pilot caps** are constants: 25 USDT/deposit, 100 USDT/user principal, 500 USDT/group pool. A Share-Out roll-over above a cap reverts, and the member then claims to their wallet instead.
- **Bond claim window:** forfeits are allowed until `unlockAt + claimDelay` (default 1 h) so a last-minute unstake can still be reported; claims open only after that.

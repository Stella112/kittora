# Kittora

**Save in dollars and run your savings group from Nimiq Pay.** Kittora is a Nimiq Pay mini app for USDT savings
pockets and for savings groups (VSLA / esusu / ajo) on Polygon mainnet. Members never need POL: every action is a
signature in Nimiq Pay, and Kittora's relayer pays the network fee.

Live: **https://kittora.xyz** (on a desktop it shows "Open in Nimiq Pay"; the app runs inside Nimiq Pay).

## How to open it
On a phone with Nimiq Pay, open **https://nimpay.app/miniapps/open/kittora.xyz**, or in Nimiq Pay go to Mini Apps
and enter `kittora.xyz`. Sign in with your Nimiq account, connect Polygon, and hold a little USDT on Polygon.

## Features
**My Kitty** (personal savings, earning the variable Aave V3 USDT rate)
- **Flex**: save and withdraw any time. **Target**: a named goal with progress. **SafeLock**: locked by the contract
  until your date, with no early exit.
- **Autosave**: a fixed amount every hour (pilot) / day / week / 30 days, stopped any time with one tap.
- **NIM SafeLock**: keep NIM staked (with Garuda Pool) in your own wallet and back the promise with a USDT bond. If the
  stake drops below the amount before the date, the bond goes to your group's social fund.

**Group Kitty** (a digital VSLA)
- Start a group with fixed rules: share price, social fund per meeting, meeting interval and count, loan interest,
  loan limit, approvals, members, grace period and the largest social fund payment. Name, purpose and one of 8 covers.
- Invite by link; buy 1–5 shares each meeting; a public group board shows who paid which meeting.
- **Loans** up to 3× your savings, with guarantors pledging shares and member approvals. Flat interest stays in the
  pool, so everyone's share value rises. A default is cut from the borrower's shares first, then the guarantors'.
- **Social fund (for emergencies)**: any member proposes a payment to a member; it needs approvals from others,
  including a Treasurer (or the Admin when there is none), and expires after 7 days. The main pool is never spendable.
- **Roles**: Admin (edits the profile, assigns up to 2 Treasurers, hands over Admin, removes empty members),
  Treasurer, Member. Roles never move money.
- **Contribute every meeting** (group Autosave): one purchase per meeting at most; a meeting already paid by hand is
  skipped, never doubled. A failed run shows as a missed contribution.
- **Share-Out** at the end of the cycle: savings plus interest plus an equal part of the social fund, to your wallet
  or into a pocket.
- **Activity feed** per group: who did what, who approved, status (Pending approval, Approved, Submitted, Confirmed,
  Stamped on Nimiq), Polygonscan and Nimiq links; approvals that need you are pinned at the top.
- **Nimiq stamps**: after a group action (and later, for Autosave runs) members can stamp a public receipt on Nimiq
  (1 Luna to themselves with a memo naming the Polygon transaction). The relayer verifies each stamp.

Pilot limits are enforced by the contracts: 25 USDT per deposit, 100 USDT per person, 500 USDT per group pool.

## Architecture
```
Nimiq Pay (phone)
  └─ mini app (apps/web: React, Vite)   — Nimiq sign-in, EIP-712 signatures, Nimiq stamps
        │ signed requests
        ▼
  relayer (apps/relayer: Node, Hono)     — whitelisted actions, policy checks, pays gas,
        │                                  Autosave scheduler, NIM bond watcher, read index, stamp verification
        ▼
  Polygon mainnet
    PocketVault  — pockets on Aave V3, Autosave mandates, NIM bonds
    GroupKitty   — groups, shares, loans, social fund, roles, Share-Out
```
- `packages/contracts`: Solidity 0.8.28 (Foundry). `packages/core`: ABIs, EIP-712 types, stamp format.
- Hosting: one VPS behind nginx with Let's Encrypt (`deploy/vps`, `docs/DEPLOY.md`).

## Contracts (Polygon mainnet, verified on Polygonscan)
| Contract | Address |
|---|---|
| PocketVault | [`0x2583FE752256afB1F863a2D5EEea5241BD2B4bDb`](https://polygonscan.com/address/0x2583fe752256afb1f863a2d5eeea5241bd2b4bdb) |
| GroupKitty | [`0x19d8687607fD86A25F8e80a535e5A9c6A848A4a7`](https://polygonscan.com/address/0x19d8687607fd86a25f8e80a535e5a9c6a848a4a7) |
| Relayer (pays gas) | `0xb6F9689945421743157e01B6642BC55C27A2e962` |
| Attester (NIM bonds) | `0xa5924b2670243293A09c3775330c0D05A8d08a12` |

USDT: USDT0 `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`. Yield: Aave V3 Polygon Pool.

## Trust assumptions
- **Relayer**: pays gas and submits what members sign. It cannot move funds without a member's signature (signatures
  bind owner, amounts, nonce and deadline); at worst it delays or refuses requests. Members can also call the
  contracts directly.
- **Attester**: can forfeit an active NIM SafeLock bond until shortly after its unlock date, if the Nimiq stake dropped
  below the amount. It cannot touch any other pocket. Each forfeit publishes the Nimiq transaction as evidence. A
  dishonest attester could forfeit an honest bond: this is the one trust assumption on funds.
- **Roles**: the Admin and Treasurers cannot move the pool or change any money rule. Treasurers only gate social fund
  payments, which also need other members' approvals and go only to members.
- **Deployer**: wired the two contracts once at deployment and has no other power. No admin key, no pause, no upgrade.
- **Read index and stamps**: the relayer's index and feed are for display; balances are always read from the
  contracts. A stamp shows "Stamped on Nimiq" only after the relayer has checked it on both chains.

## Risks
- **Smart-contract risk**: tested (Foundry unit, fork and fuzz/invariant tests; Slither triaged in `docs/RISKS.md`)
  but not externally audited.
- **Aave V3**: yield is variable and can fall; withdrawals can be delayed if Aave's USDT pool is fully used.
- **Group credit risk**: a defaulted loan is cut from the borrower's and guarantors' shares; others are never touched.
- **Relayer availability**: if it is down, actions wait (funds stay safe and can be reached by direct contract calls).
- **Pilot**: small caps on purpose. Not tested at scale.

## Build and test
```bash
pnpm install
pnpm --filter @kittora/web test          # app unit tests
pnpm --filter @kittora/relayer test      # relayer, incl. an anvil fork of Polygon with the real contracts
cd packages/contracts && forge test      # contracts (fork + invariants)
pnpm --filter @kittora/relayer devnet    # local fork + relayer; then the web-devnet launch config
```
More: `docs/BUILD_LOG.md` (what was built and the evidence), `docs/DECISIONS.md`, `docs/RISKS.md`, `docs/DEPLOY.md`.

## License
MIT

# Vibeathon 02 submission draft

Submit at app.vibestarter.xyz/vibeathon/submit, signed in with the wallet you applied with.
Deadline: **Mon 9 Nov 2026, 22:00 UTC**. Entries can be edited until then, so submit early and update.
Full rules: blog.vibestarter.xyz/vibeathon-02.

## Required

**Project name**
Kittora

**Tagline (one line)**
Save in dollars and run your savings group from Nimiq Pay: shares, guaranteed loans and Share-Out, gas-free on Polygon.

**Live URL**
https://kittora.xyz (opens the "Open in Nimiq Pay" screen on desktop; the app runs inside Nimiq Pay)

**What it does and what to try**
Kittora is a Nimiq Pay mini app for saving in USDT and for savings groups (VSLA / esusu) on Polygon mainnet.
- *My Kitty*: Flex, Target and SafeLock pockets earning the variable Aave V3 rate, Autosave, and a NIM SafeLock bond.
- *Group Kitty*: start a group with fixed rules, invite members by link, buy shares each meeting, borrow with
  guarantors, a social fund for members in need, and Share-Out of savings plus interest at the end of the cycle.
- Users never hold POL: every action is a signature in Nimiq Pay, and Kittora's relayer pays the gas.
- Pilot limits are enforced by the contracts: 25 USDT per deposit, 100 USDT per person, 500 USDT per group.

What to try (inside Nimiq Pay, with ~2 USDT on Polygon):
1. Sign in, connect Polygon, open a Flex pocket with 1 USDT, then withdraw it.
2. Groups → Start a group (hourly pilot), share the invite with a second phone, both buy a share.
3. Ask for a small loan with the other member as guarantor; they approve; pay it out; repay it.
4. Activity: every step with its Polygonscan link.

Contracts (verified on Polygonscan): PocketVault `0x2583FE752256afB1F863a2D5EEea5241BD2B4bDb`,
GroupKitty `0x19d8687607fD86A25F8e80a535e5A9c6A848A4a7`.

**AI tools it was built with**
Claude Code (Claude Opus). `TODO: add any other tools you used.`

## Optional
- Repo: https://github.com/Stella112/kittora
- Demo video: `TODO` (the local devnet in BUILD_LOG.md Phase 5 can be used to record a full group cycle)
- Screenshot: `TODO`
- Project X handle: `TODO`
- Fundable score link (fundable.vibestarter.xyz, shown to judges for information, not scored): `TODO`

## Before submitting
- [x] Live URL loads (https://kittora.xyz, Nov 6)
- [ ] Phone smoke test in Nimiq Pay (docs/DEPLOY.md, step 6) passes
- [x] Relayer `/health` is `ok:true` (1.96 POL, Nov 6)
- [ ] Theme "Night shift": decide whether and how to mention it (not written here)

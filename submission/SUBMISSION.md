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
`TODO: Vercel URL after docs/DEPLOY.md step 3` (opens the "Open in Nimiq Pay" screen on desktop; the app runs inside Nimiq Pay)

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

Contracts (verified on Polygonscan): PocketVault `0x7B1e1bAed045Db95b5F5b3E1e6E50efdac851251`,
GroupKitty `0x2271dA8756185B48A46A17051fF3A90d6481ed5f`.

**AI tools it was built with**
Claude Code (Claude Opus). `TODO: add any other tools you used.`

## Optional
- Repo: https://github.com/Stella112/kittora
- Demo video: `TODO` (the local devnet in BUILD_LOG.md Phase 5 can be used to record a full group cycle)
- Screenshot: `TODO`
- Project X handle: `TODO`
- Fundable score link (fundable.vibestarter.xyz, shown to judges for information, not scored): `TODO`

## Before submitting
- [ ] Live URL loads and the phone smoke test in docs/DEPLOY.md step 4 passes
- [ ] Relayer `/health` is `ok:true` (enough POL)
- [ ] Theme "Night shift": decide whether and how to mention it (not written here)

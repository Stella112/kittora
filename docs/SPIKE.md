# Gate 0: Spike results

| # | Check | Status | Evidence |
|---|---|---|---|
| S1 | listAccounts + sign, verified server-side | Server verify **PASS** (local test keys); device run pending | `apps/spike/server/selftest.mjs`; smoke: valid sig accepted, replayed challenge rejected |
| S2 | Native staking on testnet | Pending device | |
| S3 | Memo stamp | Pending device | |
| S4 | eth_signTypedData_v4 recovers | Server recover **PASS** (local); device pending | |
| S5 | Gasless USDT (zero POL) | **Fork PASS**; mainnet device run pending (cap 5 USDT) | `apps/spike/contracts` `forge test`: `test_gaslessApproveDepositWithdraw`, `test_capEnforced` |
| S6 | Aave V3 supply/withdraw from contract | **PASS** (fork) | `packages/contracts/test/spike/AaveFork.t.sol`: 10 USDT → 10.029313 after 30 days, fully withdrawn |
| S7 | HTLC awareness | Pending device | |

## Device checklist for Maris

### One-time setup (on the laptop)
1. Phone and laptop on the same Wi-Fi. Laptop LAN IP is currently `192.168.1.45`.
2. Terminal 1: `cd C:\nimiq\apps\spike` then `node server/verify.mjs` (wait for "spike server :8787").
3. Terminal 2: `cd C:\nimiq\apps\spike` then `pnpm dev`.
4. If Windows Firewall asks, allow Node on **private** networks.
5. In Nimiq Pay: Mini Apps → Custom URL → `http://192.168.1.45:5175`.
6. **Screenshot the "Env" box** and send it to me.

### Part A: Nimiq testnet (S1, S2, S3, S7)
Switch Nimiq Pay to testnet first: long-press the settings button for 10 s → dev menu → switch network → get free NIM.
1. **S1:** tap *Run S1* → approve the sign request. Copy the whole S1 box.
2. **S7:** tap *Inspect accounts*. Copy the box.
3. **S3:** leave recipient blank, tap *Send 0.01 NIM with memo*, approve. Copy the box (it contains the tx).
4. **S2:** paste a testnet validator address (I will provide one, or use the one Nimiq Pay's staking screen shows), amount `1`:
   1. *New staker* → approve → copy box.
   2. *Add stake* (amount 1) → approve → copy box.
   3. *Retire* (amount 1) → approve → copy box.
   4. *Remove* only works after the retire is finalised; try it, and copy the result or the error.
5. For each tx, screenshot the confirmation screen Nimiq Pay shows.

### Part B: Polygon mainnet (S4, S5). Real USDT, max 5 USDT.
Before S5 we need: (a) you send me the relayer address after you fund it with ~1 POL; I put its key in `apps/spike/.env` (you paste it, I never print it); (b) you approve deploying SpikeVault to mainnet. Deploy command (you run it, or approve me running it):
```
cd C:\nimiq\apps\spike\contracts
forge create src/SpikeVault.sol:SpikeVault --rpc-url https://polygon-bor-rpc.publicnode.com --private-key $RELAYER_PRIVATE_KEY --broadcast --constructor-args 0xc2132D05D31c914a87C6611C10748AEb04B58e8F
```
Then put `SPIKE_VAULT=<address>` in `apps/spike/.env` and restart the server.

1. Switch Nimiq Pay back to mainnet. Hold 1–2 USDT on Polygon, **0 POL**.
2. **S4:** tap *Run S4* → approve. Copy box.
3. **S5:** amount `1`.
   1. *State* → copy (confirms userPol = 0).
   2. *1. Sign approve* → approve → copy box (relay tx hash).
   3. *2. Sign deposit* → approve → copy.
   4. *State* again → copy.
   5. *3. Sign withdraw* → approve → copy.
4. Screenshot each signing prompt (we need to see what the user sees for Rule "approval screens state what you sign").

Record: phone model, OS version, Nimiq Pay version (Settings → About).

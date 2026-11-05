# Sources

Every external fact used in code is listed here: what, where, date checked.
Nimiq Pay source = https://github.com/nimiq/nimiq-pay-app @ `2115a8d3839a2233ce57951dff75a3ce3449cf17` (main, committed Nov 5 2026).

## Nimiq Pay host behaviour (checked Nov 5 2026)

| Fact | Source | Notes |
|---|---|---|
| Allowed mini-app EVM chains: 1, 137, 42161, 10, 8453, 56, 11155111 | `web3-provider/src/allowedChains.ts` | Matches brief §1A. Polygon Amoy not allowed. |
| Host ignores mini-app `rpcUrl` for allowlisted chains | `src/composables/useMiniAppHost.ts` L398 (`customRpcUrl = isAllowedChain ? undefined : request.rpcUrl`) | Never pass `rpcUrl`. |
| EIP-712 signing: host strips `EIP712Domain` from `types` and calls ethers `signTypedData(domain, types, message)` | `useMiniAppHost.ts` ~L900–960 | If `domain.chainId` is present it must equal the current chain; domains without chainId (e.g. salt-based) are accepted. User sees name/chain/type/JSON message. |
| Nimiq `sign()` = Ed25519 over `SHA256("\x16Nimiq Signed Message:\n" + len + msgBytes)`; returns `{publicKey, signature}` | `useMiniAppHost.ts` L1560–1620 | Server verify: `apps/spike/server/nimiq-verify.mjs`. Address = `publicKey.toAddress()`. |
| Gasless USDT approval: `MetaTransaction(uint256 nonce,address from,bytes functionSignature)` over `approve(spender, amount)`, domain `{name: token.name(), version: "1", verifyingContract: token, salt: bytes32(chainId)}` | `src/stores/polygon-usdt.ts` L1026–1062 (`signTokenApproval`), `src/lib/polygon/token-meta-tx.ts` | Nimiq Pay submits via OpenGSN RelayHub `0x6C28…750d`; Kittora uses its own relayer calling `executeMetaTransaction` directly. |
| Polygon USDT token `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | `src/lib/polygon/config.ts` L12 | Also equals `AaveV3PolygonAssets.USDT0_UNDERLYING`. |
| Nimiq provider methods (listAccounts, sign, getBalance, sendBasicTransaction(WithData), staking ×6) | `useMiniAppHost.ts` L1465–1478 + installed SDK types | |
| `accountsChanged` fires "when the host replaces the approved accounts, e.g. with a new HTLC address" | `@nimiq/mini-app-sdk@0.2.5` `dist/index.d.ts` | Relevant to S7: listAccounts may return an HTLC address. To verify on device. |

## SDK (`@nimiq/mini-app-sdk` pinned **0.2.5**, same as Nimiq Pay's own example dApp `mini-app-sdk/dapp/package.json`)

- Param shapes from `dist/provider.d.ts`: `sendNewStakerTransaction({delegation, value})`, `sendStakeTransaction({value})`, `sendSetActiveStakeTransaction({newActiveBalance})`, `sendUpdateStakerTransaction({newDelegation, reactivateAllStake?})`, `sendRetireStakeTransaction({retireStake})`, `sendRemoveStakeTransaction({value})`, `sendBasicTransactionWithData({recipient, value, data})`. All amounts in Luna, `fee`/`validityStartHeight` optional.
- **1 NIM = 100,000 Luna**: `dist/provider.d.ts` (getBalance and staking doc comments: "100,000 luna = 1 NIM", "1 NIM = 1e5 Lunas").
- `getHostNetwork()` returns `'mainnet' | 'testnet' | undefined` → drives the TESTNET badge.

## On-chain reads (Polygon 137, RPC https://polygon-bor-rpc.publicnode.com, Nov 6 2026)

| Read | Result |
|---|---|
| USDT `name()` | `"USDT0"` (token upgraded to USDT0; name is read dynamically, never hard-coded) |
| `decimals()` | 6 |
| `getNonce(address)` | exists (returns 0 for 0x…dEaD) |
| `getDomainSeperator()` (sic) | `0x7b43b7de…9a05`, equals our locally computed salt-domain separator |
| `ERC712_VERSION()` | `"1"` |
| `executeMetaTransaction(...)` | exists (reverts on bad signature, not unknown selector) |
| Proxy impl (slot `keccak("matic.network.proxy.implementation")`) | `0x90040487a6c9f949c4f07cadcfb0f3b8eeab4229` |
| Explorer | https://polygonscan.com/token/0xc2132D05D31c914a87C6611C10748AEb04B58e8F |

## Libraries

- OpenZeppelin Contracts **v5.7.0** (`cab19933`), git submodule.
- `@bgd-labs/aave-address-book` @ `b71495ae` (Nov 5 2026): `AaveV3Polygon.POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD`, `USDT0_UNDERLYING = 0xc213…8e8F`, `USDT0_A_TOKEN = 0x6ab707Aca953eDAeFBc4fD23bA73294241490620`.

## Still to verify
- Deeplinks `nimiqpay://miniapp?url=` and `https://nimpay.app/miniapps/open/<domain>`: search the Nimiq Pay source and docs (Phase 3).
- Nimiq testnet explorer and RPC for the watcher (Phase 2).

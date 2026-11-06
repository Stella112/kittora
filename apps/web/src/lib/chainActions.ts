// Every money action = user signs typed data in Nimiq Pay → relayer submits and pays gas → we wait for the receipt.
import { encodeFunctionData, parseAbi, type Abi, type Address, type Hex } from 'viem'
import { PocketVaultAbi, GroupKittyAbi, vaultTyped, groupTyped, usdtMetaTxTyped, toSignTypedDataV4, USDT_POLYGON, type VaultPrimary, type GroupPrimary } from '@kittora/core'
import { config } from '../config.ts'
import { reader, signTypedJson } from './evm.ts'
import { relayer } from './relayer.ts'
import { makeError } from './errors.ts'

export const usdtAbi = parseAbi([
  'function getNonce(address) view returns (uint256)',
  'function name() view returns (string)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256)',
])

/** Aave V3 Polygon Pool: AaveV3Polygon.POOL from @bgd-labs/aave-address-book @b71495ae (docs/SOURCES.md). */
export const AAVE_POOL: Address = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
const aaveAbi = [{
  type: 'function', name: 'getReserveData', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }],
  outputs: [{ type: 'tuple', components: [
    { name: 'configuration', type: 'tuple', components: [{ name: 'data', type: 'uint256' }] },
    { name: 'liquidityIndex', type: 'uint128' }, { name: 'currentLiquidityRate', type: 'uint128' },
    { name: 'variableBorrowIndex', type: 'uint128' }, { name: 'currentVariableBorrowRate', type: 'uint128' },
    { name: 'currentStableBorrowRate', type: 'uint128' }, { name: 'lastUpdateTimestamp', type: 'uint40' },
    { name: 'id', type: 'uint16' }, { name: 'aTokenAddress', type: 'address' }, { name: 'stableDebtTokenAddress', type: 'address' },
    { name: 'variableDebtTokenAddress', type: 'address' }, { name: 'interestRateStrategyAddress', type: 'address' },
    { name: 'accruedToTreasury', type: 'uint128' }, { name: 'unbacked', type: 'uint128' }, { name: 'isolationModeTotalDebt', type: 'uint128' },
  ] }],
}] as const

export async function aaveSupplyRateRay(): Promise<bigint> {
  const d = await reader().readContract({ address: AAVE_POOL, abi: aaveAbi, functionName: 'getReserveData', args: [USDT_POLYGON] })
  return d.currentLiquidityRate
}

export const polygonscanTx = (h: string) => `https://polygonscan.com/tx/${h}`
/** Format used by NimBooks (reference app): https://nimiq.watch/#<hash>; testnet host test.nimiq.watch. */
export const nimiqTx = (h: string, testnet: boolean) => `https://${testnet ? 'test.' : ''}nimiq.watch/#${h.replace(/^0x/, '')}`

const VAULT = () => { if (!config.vault) throw makeError('not_deployed'); return config.vault }
const GROUP = () => { if (!config.groupKitty) throw makeError('not_deployed'); return config.groupKitty }

export const vaultNonce = (a: Address) => reader().readContract({ address: VAULT(), abi: PocketVaultAbi as Abi, functionName: 'nonces', args: [a] }) as Promise<bigint>
export const groupNonce = (a: Address) => reader().readContract({ address: GROUP(), abi: GroupKittyAbi as Abi, functionName: 'nonces', args: [a] }) as Promise<bigint>
// The relayer checks deadlines against wall time, the contract against block time: sign for the later of the two.
let chainAhead = 0
/** Record the latest block time seen (seconds) so deadlines stay valid if the chain clock runs ahead of the phone. */
export function noteChainTime(ts: bigint) { chainAhead = Math.max(0, Number(ts) - Math.floor(Date.now() / 1000)) }
export const deadline = () => BigInt(Math.floor(Date.now() / 1000) + chainAhead + 20 * 60)

export async function signAndRelayVault(action: string, primary: VaultPrimary, owner: Address, message: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<Hex> {
  const sig = await signTypedJson(owner, toSignTypedDataV4(vaultTyped(VAULT(), primary, message, config.chainId)))
  const { hash } = await relayer.relay({ action, params: message, signature: sig, ...extra })
  return hash
}

export async function signAndRelayGroup(action: string, primary: GroupPrimary, signer: Address, message: Record<string, unknown>): Promise<Hex> {
  const sig = await signTypedJson(signer, toSignTypedDataV4(groupTyped(GROUP(), primary, message, config.chainId)))
  const { hash } = await relayer.relay({ action, params: message, signature: sig })
  return hash
}

/** Permissionless calls (disburse, markDefault): nothing to sign, the contract checks every rule. */
export async function relayOpen(action: 'group.disburse' | 'group.markDefault', loanId: bigint): Promise<Hex> {
  const { hash } = await relayer.relay({ action, params: { loanId } })
  return hash
}

export const usdtBalance =(a: Address) => reader().readContract({ address: USDT_POLYGON, abi: usdtAbi, functionName: 'balanceOf', args: [a] })
export const allowanceOf = (a: Address, spender: Address) => reader().readContract({ address: USDT_POLYGON, abi: usdtAbi, functionName: 'allowance', args: [a, spender] })

/** Gasless USDT approve(spender, amount) via the token's meta-transaction, the same pattern Nimiq Pay uses. */
export async function gaslessApprove(owner: Address, spender: Address, amount: bigint): Promise<Hex> {
  const r = reader()
  const [nonce, name] = await Promise.all([
    r.readContract({ address: USDT_POLYGON, abi: usdtAbi, functionName: 'getNonce', args: [owner] }),
    r.readContract({ address: USDT_POLYGON, abi: usdtAbi, functionName: 'name' }),
  ])
  const fnSig = encodeFunctionData({ abi: usdtAbi, functionName: 'approve', args: [spender, amount] })
  const sig = await signTypedJson(owner, toSignTypedDataV4(usdtMetaTxTyped(name, owner, nonce, fnSig, config.chainId)))
  const { hash } = await relayer.relay({ action: 'usdt.approve', params: { owner, spender, amount, nonce }, signature: sig })
  return hash
}

/** Polls the relayer for the receipt. Never reports success before the chain confirms. */
export async function waitConfirmed(hash: Hex, timeoutMs = 120_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const s = await relayer.status(hash).catch(() => null)
    if (s?.status === 'confirmed') return
    if (s?.status === 'failed') throw Object.assign(new Error('Transaction failed on-chain'), { error: 'send_failed' })
    await new Promise(r => setTimeout(r, 2500))
  }
  throw Object.assign(new Error('still pending'), { error: 'pending', hash })
}

export { VAULT, GROUP }

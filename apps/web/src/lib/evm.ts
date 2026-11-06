// Polygon through Nimiq Pay's injected Ethereum provider. The host always uses its own RPC for allowlisted chains
// (nimiq-pay-app PR #65), so we never pass an rpcUrl. Dev preview outside Nimiq Pay falls back to a public RPC.
import { createPublicClient, custom, http, type Address, type PublicClient } from 'viem'
import { polygon } from 'viem/chains'
import { config } from '../config.ts'
import { makeError } from './errors.ts'

type Eip1193 = { request: (a: { method: string, params?: unknown[] }) => Promise<unknown> }

export function ethereum(): Eip1193 | null {
  return ((window as unknown as { ethereum?: Eip1193 }).ethereum) ?? null
}

let client: PublicClient | null = null
export function reader(): PublicClient {
  const eth = ethereum()
  client ??= createPublicClient({ chain: polygon, transport: eth ? custom(eth) : http('https://polygon-bor-rpc.publicnode.com'), batch: { multicall: true } }) as PublicClient
  return client
}

const HEX_CHAIN = `0x${config.chainId.toString(16)}`

export async function connectEvm(): Promise<Address> {
  const eth = ethereum()
  if (!eth) throw makeError('not_in_nimiq_pay', 'window.ethereum missing')
  const [a] = await eth.request({ method: 'eth_requestAccounts' }) as Address[]
  if (!a) throw makeError('rejected', 'no account returned')
  await ensurePolygon()
  return a
}

export async function ensurePolygon() {
  const eth = ethereum()
  if (!eth) throw makeError('not_in_nimiq_pay')
  const current = await eth.request({ method: 'eth_chainId' }) as string
  if (current?.toLowerCase() === HEX_CHAIN) return
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: HEX_CHAIN }] })
  } catch (e) {
    const err = e as { code?: number }
    if (err.code === 4001) throw makeError('rejected', String(e))
    throw makeError('wrong_network', String(e))
  }
}

/** eth_signTypedData_v4 with a JSON payload (see @kittora/core toSignTypedDataV4). */
export async function signTypedJson(address: Address, json: string): Promise<`0x${string}`> {
  const eth = ethereum()
  if (!eth) throw makeError('not_in_nimiq_pay')
  await ensurePolygon()
  return eth.request({ method: 'eth_signTypedData_v4', params: [address, json] }) as Promise<`0x${string}`>
}

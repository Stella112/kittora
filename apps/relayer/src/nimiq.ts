// Nimiq helpers: sign() verification (mirrors Nimiq Pay host useMiniAppHost.ts @2115a8d) and JSON-RPC reads
// (methods from core-rs-albatross rpc-interface/src/blockchain.rs: getStakerByAddress, getTransactionsByAddress).
import { Address, BufferUtils, Hash, PublicKey, Signature } from '@nimiq/core'

export function nimiqMessageHash(message: string) {
  const msg = new TextEncoder().encode(message)
  const prefix = new TextEncoder().encode(`\x16Nimiq Signed Message:\n${msg.length}`)
  const payload = new Uint8Array(prefix.length + msg.length)
  payload.set(prefix)
  payload.set(msg, prefix.length)
  return Hash.computeSha256(payload)
}

/** Returns the signer's user-friendly address, or throws. */
export function verifyNimiqSignature(message: string, publicKeyHex: string, signatureHex: string): string {
  const pk = PublicKey.fromHex(publicKeyHex.replace(/^0x/, ''))
  const sig = Signature.fromHex(signatureHex.replace(/^0x/, ''))
  if (!pk.verify(sig, nimiqMessageHash(message))) throw new Error('nimiq signature invalid')
  return pk.toAddress().toUserFriendlyAddress()
}

export function nimiqToBytes20(userFriendly: string): `0x${string}` {
  return `0x${BufferUtils.toHex(Address.fromUserFriendlyAddress(userFriendly).serialize())}` as `0x${string}`
}

export function bytes20ToNimiq(hex: string): string {
  return Address.deserialize(BufferUtils.fromHex(hex.replace(/^0x/, ''))).toUserFriendlyAddress()
}

export class NimiqRpc {
  private url: string
  private id = 0
  constructor(url: string) {
    this.url = url
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }) })
    const j = await res.json() as { result?: { data: T }, error?: unknown }
    if (j.error !== undefined) throw Object.assign(new Error(`nimiq rpc ${method}: ${JSON.stringify(j.error)}`), { rpcError: j.error })
    return j.result!.data
  }

  /** Active stake in Luna; 0 if the address is not (or no longer) a staker. */
  async activeStake(address: string): Promise<{ active: number, found: boolean }> {
    try {
      const s = await this.call<{ balance: number }>('getStakerByAddress', [address])
      return { active: s.balance, found: true }
    } catch (e) {
      // Only the explicit "No staker with address" error means zero stake. Any other error (network, method
      // not allowed, internal) is rethrown so a flaky RPC can never cause a forfeit.
      const data = (e as { rpcError?: { data?: unknown } }).rpcError?.data
      if (typeof data === 'string' && data.startsWith('No staker with address')) return { active: 0, found: false }
      throw e
    }
  }

  /** One transaction by hash (getTransactionByHash). recipientData is hex; for a basic tx it carries the message. */
  async transaction(hash: string): Promise<{ hash: string, from: string, to: string, value: number, confirmations: number, executionResult: boolean, recipientData: string } | null> {
    try {
      return await this.call('getTransactionByHash', [hash.replace(/^0x/, '')])
    } catch (e) {
      if ((e as { rpcError?: unknown }).rpcError !== undefined) return null
      throw e
    }
  }

  /** Latest transaction hashes touching the address (newest first). */
  async latestTxs(address: string, max = 10): Promise<{ hash: string, blockNumber: number, recipientData: string, senderData: string, to: string, from: string }[]> {
    return this.call('getTransactionsByAddress', [address, max, null])
  }
}

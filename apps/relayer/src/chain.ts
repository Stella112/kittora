import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex, type PublicClient, type WalletClient, type Chain } from 'viem'
import { polygon } from 'viem/chains'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import type { Logger } from 'pino'

export function makeChain(chainId: number): Chain {
  return chainId === 137 ? polygon : { ...polygon, id: chainId, name: `fork-${chainId}` }
}

export class RelayError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

/**
 * Serialises sends from one hot wallet so concurrent requests never reuse a nonce.
 * The local nonce is resynced from the chain (pending) after any send failure.
 */
export class TxSender {
  private chainTail: Promise<unknown> = Promise.resolve()
  private nonce: number | null = null
  readonly account: PrivateKeyAccount
  readonly wallet: WalletClient
  readonly pub: PublicClient
  private log: Logger
  private gasCap: bigint
  constructor(pub: PublicClient, pk: Hex, chain: Chain, rpcUrl: string, log: Logger, gasCap: bigint) {
    this.pub = pub
    this.log = log
    this.gasCap = gasCap
    this.account = privateKeyToAccount(pk)
    this.wallet = createWalletClient({ account: this.account, chain, transport: http(rpcUrl, { timeout: 60_000 }) })
  }

  /** Simulate (eth_call) → estimate gas (≤ cap) → send with the next nonce. Returns the tx hash once broadcast. */
  send(address: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<Hex> {
    const run = async () => {
      try {
        await this.pub.simulateContract({ account: this.account, address, abi, functionName, args })
      } catch (e) {
        throw new RelayError('simulation_failed', revertReason(e))
      }
      const gas = await this.pub.estimateContractGas({ account: this.account, address, abi, functionName, args })
      if (gas > this.gasCap) throw new RelayError('gas_cap', `gas ${gas} above cap ${this.gasCap}`)
      for (let attempt = 0; ; attempt++) {
        // Never trust a cached nonce below the chain's pending count (another process may have used the key).
        const pending = await this.pub.getTransactionCount({ address: this.account.address, blockTag: 'pending' })
        if (this.nonce === null || this.nonce < pending) this.nonce = pending
        const nonce = this.nonce
        try {
          const hash = await this.wallet.writeContract({ address, abi, functionName, args, nonce, gas: (gas * 12n) / 10n, account: this.account, chain: this.wallet.chain })
          this.nonce = nonce + 1
          this.log.info({ hash, functionName, nonce }, 'tx sent')
          return hash
        } catch (e) {
          this.nonce = null
          const msg = revertReason(e)
          if (attempt === 0 && /nonce|underpriced|already known/i.test(msg)) {
            this.log.warn({ err: msg, functionName }, 'nonce conflict, resyncing and retrying once')
            continue
          }
          this.log.error({ err: msg, functionName }, 'send failed')
          throw new RelayError('send_failed', msg, 502)
        }
      }
    }
    const p = this.chainTail.then(run, run)
    this.chainTail = p.catch(() => undefined)
    return p
  }
}

export function revertReason(e: unknown): string {
  const err = e as { shortMessage?: string, message?: string, cause?: { data?: { errorName?: string } } }
  const name = err?.cause?.data?.errorName
  return name ? `reverted: ${name}` : (err?.shortMessage ?? err?.message ?? String(e)).slice(0, 300)
}

export function publicClient(rpcUrl: string, chain: Chain): PublicClient {
  return createPublicClient({ chain, transport: http(rpcUrl, { timeout: 60_000 }) }) as PublicClient
}

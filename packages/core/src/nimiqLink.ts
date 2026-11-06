// NIM SafeLock link message (Maris item 12): the user's Nimiq key signs a message binding their Nimiq address to
// their EVM address, the lock ID, the chain and the vault, so the signature cannot be replayed elsewhere.
// Lock ID = the owner's PocketVault EIP-712 nonce used for the LockBond request (unique per owner).
import { keccak256, toBytes, concat, type Address, type Hex } from 'viem'

export interface LinkParams {
  nimiqAddress: string // user-friendly, e.g. "NQ.. .."
  evmAddress: Address
  lockNonce: bigint
  chainId: number
  vault: Address
  nimLuna: bigint
  unlockAt: bigint
}

export function linkMessage(p: LinkParams): string {
  return [
    'Kittora NIM SafeLock link v1',
    `nimiq: ${p.nimiqAddress}`,
    `evm: ${p.evmAddress.toLowerCase()}`,
    `lock: ${p.lockNonce}`,
    `chain: ${p.chainId}`,
    `vault: ${p.vault.toLowerCase()}`,
    `bonded NIM (luna): ${p.nimLuna}`,
    `unlockAt: ${p.unlockAt}`,
  ].join('\n')
}

/** Stored on-chain as LockBond.linkHash. publicKey/signature are hex from Nimiq `sign()`. */
export function linkHash(message: string, publicKeyHex: string, signatureHex: string): Hex {
  const h = (x: string) => toBytes(x.startsWith('0x') ? (x as Hex) : (`0x${x}` as Hex))
  return keccak256(concat([toBytes(message), h(publicKeyHex), h(signatureHex)]))
}

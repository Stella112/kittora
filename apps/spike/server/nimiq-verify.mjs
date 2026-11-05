// THROWAWAY spike. Mirrors Nimiq Pay host sign() (useMiniAppHost.ts @2115a8d, lines ~1560-1620):
// hash = SHA256("\x16Nimiq Signed Message:\n" + len(msgBytes) + msgBytes); Ed25519 signature over hash.
import { Address, BufferUtils, Hash, PublicKey, Signature } from '@nimiq/core'

export function nimiqMessageHash(message, isHex = false) {
  const msg = isHex
    ? BufferUtils.fromHex(message.startsWith('0x') ? message.slice(2) : message)
    : new TextEncoder().encode(message)
  const prefix = new TextEncoder().encode(`\x16Nimiq Signed Message:\n${msg.length}`)
  const payload = new Uint8Array(prefix.length + msg.length)
  payload.set(prefix); payload.set(msg, prefix.length)
  return Hash.computeSha256(payload)
}

/** Returns the user-friendly address if valid, otherwise throws. */
export function verifyNimiqSignature({ message, isHex, publicKey, signature, expectedAddress }) {
  const pk = PublicKey.fromHex(publicKey)
  const sig = Signature.fromHex(signature)
  if (!pk.verify(sig, nimiqMessageHash(message, isHex))) throw new Error('signature invalid')
  const address = pk.toAddress().toUserFriendlyAddress()
  if (expectedAddress && Address.fromUserFriendlyAddress(expectedAddress).toUserFriendlyAddress() !== address)
    throw new Error(`address mismatch: key is ${address}, expected ${expectedAddress}`)
  return address
}

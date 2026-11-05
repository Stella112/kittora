// Labelled TEST: generates a throwaway key, signs the way the host does, verifies.
import { KeyPair } from '@nimiq/core'
import { nimiqMessageHash, verifyNimiqSignature } from './nimiq-verify.mjs'

const kp = KeyPair.generate()
const message = 'Kittora sign-in test nonce 123'
const sig = kp.sign(nimiqMessageHash(message))
const addr = verifyNimiqSignature({
  message, publicKey: kp.publicKey.toHex(), signature: sig.toHex(),
  expectedAddress: kp.toAddress().toUserFriendlyAddress(),
})
console.log('valid sig ->', addr)
try {
  verifyNimiqSignature({ message: message + 'x', publicKey: kp.publicKey.toHex(), signature: sig.toHex() })
  console.log('FAIL: tampered message accepted'); process.exit(1)
} catch (e) { console.log('tampered message rejected:', e.message) }

// Unit tests: Nimiq sign-in. TEST keys generated per run.
import { describe, it, expect } from 'vitest'
import { KeyPair } from '@nimiq/core'
import { Auth } from '../src/auth.ts'
import { nimiqMessageHash } from '../src/nimiq.ts'

describe('Nimiq sign-in', () => {
  const auth = new Auth('test-secret-0123456789')
  const kp = KeyPair.generate()
  const address = kp.toAddress().toUserFriendlyAddress()
  const signed = (message: string) => ({ publicKey: kp.publicKey.toHex(), signature: kp.sign(nimiqMessageHash(message)).toHex() })

  it('issues a token for a valid signature, once', () => {
    const ch = auth.challenge()
    const input = { ...ch, address, ...signed(ch.message) }
    const { token, nimiqAddress } = auth.verify(input)
    expect(nimiqAddress).toBe(address)
    expect(auth.check(token)).toBe(address)
    expect(() => auth.verify(input)).toThrow(/challenge/)
  })

  it('rejects wrong address, tampered message, expired challenge, forged token', () => {
    const other = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const ch = auth.challenge()
    expect(() => auth.verify({ ...ch, address: other, ...signed(ch.message) })).toThrow(/not from this address/)
    const ch2 = auth.challenge()
    expect(() => auth.verify({ ...ch2, address, ...signed(ch2.message + 'x') })).toThrow(/invalid/)
    const ch3 = auth.challenge(0)
    expect(() => auth.verify({ ...ch3, address, ...signed(ch3.message) })).toThrow(/expired/)
    const ch4 = auth.challenge()
    const { token } = auth.verify({ ...ch4, address, ...signed(ch4.message) })
    expect(auth.check(token.slice(0, -2) + 'xx')).toBeNull()
    expect(auth.check(token, Date.now() + 8 * 24 * 3600_000)).toBeNull()
  })
})

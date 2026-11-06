// Cross-checks the browser-side Nimiq address → bytes20 conversion against @nimiq/core (TEST keys).
import { describe, it, expect } from 'vitest'
import { Address, BufferUtils, KeyPair } from '@nimiq/core'
import { nimiqToHex } from './nimiqAddress.ts'

describe('nimiqToHex', () => {
  it('matches @nimiq/core serialization for random addresses', () => {
    for (let i = 0; i < 20; i++) {
      const a = KeyPair.generate().toAddress()
      expect(nimiqToHex(a.toUserFriendlyAddress())).toBe(`0x${BufferUtils.toHex(a.serialize())}`)
    }
    const fixed = 'NQ28 14BK PQR5 2EB3 L744 LT46 AV6G H1PJ N6X0'
    expect(nimiqToHex(fixed)).toBe(`0x${BufferUtils.toHex(Address.fromUserFriendlyAddress(fixed).serialize())}`)
  })
})

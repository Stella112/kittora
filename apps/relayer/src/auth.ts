// Nimiq sign-in (brief §4.1 item 3): challenge → user signs with Nimiq Pay `sign()` → server verifies → session token.
// Token = base64url(payload).HMAC-SHA256(payload). Stateless; challenges are single-use and expire after 5 minutes.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { verifyNimiqSignature } from './nimiq.ts'

const CHALLENGE_TTL_MS = 5 * 60_000
const SESSION_TTL_S = 7 * 24 * 3600

export class Auth {
  private challenges = new Map<string, number>()
  private secret: string
  constructor(secret: string) {
    this.secret = secret
  }

  challenge(now = Date.now()) {
    for (const [k, exp] of this.challenges) if (exp < now) this.challenges.delete(k)
    const nonce = randomUUID()
    this.challenges.set(nonce, now + CHALLENGE_TTL_MS)
    return { nonce, message: `Sign in to Kittora\n\nThis only proves you own this Nimiq address. It costs nothing and moves no funds.\n\nnonce: ${nonce}` }
  }

  verify(input: { nonce: string, message: string, address: string, publicKey: string, signature: string }, now = Date.now()) {
    const exp = this.challenges.get(input.nonce)
    if (!exp || exp < now || !input.message.endsWith(`nonce: ${input.nonce}`)) throw new Error('challenge unknown or expired')
    this.challenges.delete(input.nonce)
    const signer = verifyNimiqSignature(input.message, input.publicKey, input.signature)
    if (signer.replace(/\s/g, '') !== input.address.replace(/\s/g, '').toUpperCase()) throw new Error('signature is not from this address')
    const payload = Buffer.from(JSON.stringify({ sub: signer, exp: Math.floor(now / 1000) + SESSION_TTL_S })).toString('base64url')
    return { token: `${payload}.${this.mac(payload)}`, nimiqAddress: signer }
  }

  /** Returns the Nimiq address for a valid token, or null. */
  check(token: string | undefined, now = Date.now()): string | null {
    if (!token) return null
    const [payload, mac] = token.split('.')
    if (!payload || !mac) return null
    const expect = Buffer.from(this.mac(payload))
    const got = Buffer.from(mac)
    if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null
    const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub: string, exp: number }
    return exp * 1000 > now ? sub : null
  }

  private mac(payload: string) {
    return createHmac('sha256', this.secret).update(payload).digest('base64url')
  }
}

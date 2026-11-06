import { describe, it, expect } from 'vitest'
import { classify } from './errors.ts'

describe('classify: every §4.1 item 5 case maps to a kind with a retry path', () => {
  const cases: [unknown, string][] = [
    [{ code: 4001, message: 'User rejected the request.' }, 'rejected'],
    [{ message: 'Permission denied' }, 'rejected'],
    [{ code: 4902, message: 'Unrecognized chain' }, 'wrong_network'],
    [{ message: "Typed data chainId (1) doesn't match current chain (137)" }, 'wrong_network'],
    [{ error: 'simulation_failed', message: 'reverted: ERC20InsufficientBalance' }, 'no_usdt'],
    [{ error: 'send_failed', message: 'boom' }, 'relay_failed'],
    [{ error: 'rate_limited', message: 'x' }, 'relay_failed'],
    [{ error: 'pending' }, 'pending'],
    [new TypeError('Failed to fetch'), 'rpc_down'],
    [{ error: 'rpc_down', message: 'x' }, 'rpc_down'],
    [{ message: 'Nimiq Pay not detected' }, 'not_in_nimiq_pay'],
    [{ error: 'simulation_failed', message: 'reverted: Locked' }, 'blocked'],
    [{ message: '???' }, 'unknown'],
  ]
  for (const [input, kind] of cases) {
    it(`${JSON.stringify(input).slice(0, 60)} → ${kind}`, () => {
      const e = classify(input)
      expect(e.kind).toBe(kind)
      expect(e.title.length).toBeGreaterThan(0)
      expect(e.retryLabel.length).toBeGreaterThan(0)
    })
  }
  it('explains contract rules in plain words', () => {
    expect(classify({ error: 'simulation_failed', message: 'reverted: Locked' }).message).toMatch(/still locked/)
  })
})

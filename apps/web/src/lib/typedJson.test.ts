// The app sends typed data to Nimiq Pay as JSON (eth_signTypedData_v4). The host strips EIP712Domain and signs
// (useMiniAppHost.ts @2115a8d). This checks that path round-trips for every field type we use (TEST key).
import { describe, it, expect } from 'vitest'
import { verifyTypedData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { vaultTyped, groupTyped, usdtMetaTxTyped, toSignTypedDataV4 } from '@kittora/core'

const acct = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const VAULT = '0x1111111111111111111111111111111111111111'
const GK = '0x2222222222222222222222222222222222222222'

async function hostSign(json: string) {
  const td = JSON.parse(json)
  const { EIP712Domain: _drop, ...types } = td.types
  return acct.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message })
}

describe('typed data JSON path (as Nimiq Pay signs it)', () => {
  const cases = [
    vaultTyped(VAULT, 'LockBond', { owner: acct.address, amount: 5_000_000n, unlockAt: 1_900_000_000n, nimiqAddress: '0x0123456789abcdef0123456789abcdef01234567', nimLuna: 10_000_000n, groupId: 0n, linkHash: `0x${'ab'.repeat(32)}`, nonce: 3n, deadline: 1_900_000_000n }),
    vaultTyped(VAULT, 'CreateMandate', { owner: acct.address, amountPerRun: 2_000_000n, interval: 86400n, maxRuns: 4, expiry: 1_900_000_000n, toGroup: false, destId: 1n, nonce: 0n, deadline: 1_900_000_000n }),
    vaultTyped(VAULT, 'Withdraw', { owner: acct.address, pocketId: 1n, amount: 2n ** 256n - 1n, to: acct.address, nonce: 1n, deadline: 1_900_000_000n }),
    groupTyped(GK, 'RequestLoan', { borrower: acct.address, groupId: 1n, principal: 20_000_000n, duration: 604800n, guarantors: [VAULT, GK], pledges: [5n, 10n], nonce: 0n, deadline: 1_900_000_000n }),
    usdtMetaTxTyped('USDT0', acct.address, 7n, '0x095ea7b3'),
  ]
  for (const td of cases) {
    it(td.primaryType, async () => {
      const sig = await hostSign(toSignTypedDataV4(td as never))
      expect(await verifyTypedData({ address: acct.address, ...(td as never as object), signature: sig } as never)).toBe(true)
    })
  }
})

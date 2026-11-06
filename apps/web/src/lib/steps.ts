// Reusable transaction steps for My Kitty flows.
import type { Address } from 'viem'
import { allowanceOf, deadline, gaslessApprove, signAndRelayVault, VAULT, vaultNonce } from './chainActions.ts'
import type { TxStep } from '../components/TxFlow.tsx'
import { usdt } from '../components/ui.tsx'

/**
 * Approve the vault for `amount` more USDT when the current allowance is short. Approving (current + amount) keeps
 * any allowance an Autosave mandate already relies on (USDT approve overwrites, it does not add).
 */
export function approveStep(owner: Address, amount: bigint, spender: () => Address = VAULT): TxStep {
  let current = 0n
  return {
    label: `Allow Kittora to use ${usdt(amount)} USDT`,
    chain: 'polygon',
    skip: async () => {
      current = await allowanceOf(owner, spender())
      return current >= amount
    },
    run: () => gaslessApprove(owner, spender(), current + amount),
  }
}

/** Stop an Autosave, then reset the vault allowance to 0 (Maris item 5). */
export function revokeMandateSteps(owner: Address, mandateId: bigint): TxStep[] {
  return [
    { label: 'Stop the Autosave', chain: 'polygon', run: async () => signAndRelayVault('vault.revokeMandate', 'RevokeMandate', owner, { owner, mandateId, nonce: await vaultNonce(owner), deadline: deadline() }) },
    { ...setAllowanceStep(owner, 0n, 'Reset the USDT allowance to 0'), skip: async () => (await allowanceOf(owner, VAULT())) === 0n },
  ]
}

export function setAllowanceStep(owner: Address, total: bigint, label: string, spender: () => Address = VAULT): TxStep {
  return { label, chain: 'polygon', run: () => gaslessApprove(owner, spender(), total) }
}

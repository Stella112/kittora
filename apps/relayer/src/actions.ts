// The ONLY calls the relayer will ever submit. Anything else is rejected as unknown_action.
import { z } from 'zod'
import { PocketVaultAbi, GroupKittyAbi, vaultTypes, groupTypes } from '@kittora/core'
import type { Abi } from 'viem'

const big = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform(v => BigInt(v))
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(s => s.toLowerCase() as `0x${string}`)
const bytes20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(s => s as `0x${string}`)
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(s => s as `0x${string}`)

export type Target = 'vault' | 'group' | 'usdt'

export interface ActionSpec {
  target: Target
  fn: string
  /** EIP-712 primary type the user signs (null = permissionless call, no signature). */
  primaryType: string | null
  signerField: string | null
  schema: z.ZodTypeAny
  args: (p: any, sig: `0x${string}`) => readonly unknown[]
}

const s = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const ACTIONS: Record<string, ActionSpec> = {
  'vault.openPocket': {
    target: 'vault', fn: 'openPocket', primaryType: 'OpenPocket', signerField: 'owner',
    schema: s({ owner: address, kind: z.number().int().min(0).max(2), unlockAt: big, target: big, amount: big, nonce: big, deadline: big }),
    args: (p, sig) => [p, sig],
  },
  'vault.deposit': {
    target: 'vault', fn: 'deposit', primaryType: 'Deposit', signerField: 'owner',
    schema: s({ owner: address, pocketId: big, amount: big, nonce: big, deadline: big }),
    args: (p, sig) => [p.owner, p.pocketId, p.amount, p.nonce, p.deadline, sig],
  },
  'vault.withdraw': {
    target: 'vault', fn: 'withdraw', primaryType: 'Withdraw', signerField: 'owner',
    schema: s({ owner: address, pocketId: big, amount: big, to: address, nonce: big, deadline: big }),
    args: (p, sig) => [p.owner, p.pocketId, p.amount, p.to, p.nonce, p.deadline, sig],
  },
  'vault.createMandate': {
    target: 'vault', fn: 'createMandate', primaryType: 'CreateMandate', signerField: 'owner',
    schema: s({ owner: address, amountPerRun: big, interval: big, maxRuns: z.number().int().positive(), expiry: big, toGroup: z.boolean(), destId: big, nonce: big, deadline: big }),
    args: (p, sig) => [p, sig],
  },
  'vault.revokeMandate': {
    target: 'vault', fn: 'revokeMandate', primaryType: 'RevokeMandate', signerField: 'owner',
    schema: s({ owner: address, mandateId: big, nonce: big, deadline: big }),
    args: (p, sig) => [p.owner, p.mandateId, p.nonce, p.deadline, sig],
  },
  'vault.lockBond': {
    target: 'vault', fn: 'lockBond', primaryType: 'LockBond', signerField: 'owner',
    schema: s({ owner: address, amount: big, unlockAt: big, nimiqAddress: bytes20, nimLuna: big, groupId: big, linkHash: bytes32, nonce: big, deadline: big }),
    args: (p, sig) => [p, sig],
  },
  'vault.claimBond': {
    target: 'vault', fn: 'claimBond', primaryType: 'ClaimBond', signerField: 'owner',
    schema: s({ owner: address, bondId: big, nonce: big, deadline: big }),
    args: (p, sig) => [p.owner, p.bondId, p.nonce, p.deadline, sig],
  },
  'group.createGroup': {
    target: 'group', fn: 'createGroup', primaryType: 'CreateGroup', signerField: 'creator',
    schema: s({
      creator: address, sharePrice: big, socialFundPerMeeting: big, meetingInterval: big, cycleEnd: big, gracePeriod: big,
      interestBps: z.number().int(), maxLoanMultipleBps: z.number().int(), maxSharesPerMeeting: z.number().int(),
      approvalsRequired: z.number().int(), maxMembers: z.number().int(), nonce: big, deadline: big,
    }),
    args: (p, sig) => {
      const { creator, nonce, deadline, ...params } = p
      return [creator, params, nonce, deadline, sig]
    },
  },
  'group.join': {
    target: 'group', fn: 'join', primaryType: 'JoinGroup', signerField: 'member',
    schema: s({ member: address, groupId: big, nonce: big, deadline: big }),
    args: (p, sig) => [p.member, p.groupId, p.nonce, p.deadline, sig],
  },
  'group.buyShares': {
    target: 'group', fn: 'buyShares', primaryType: 'BuyShares', signerField: 'member',
    schema: s({ member: address, groupId: big, shares: big, nonce: big, deadline: big }),
    args: (p, sig) => [p.member, p.groupId, p.shares, p.nonce, p.deadline, sig],
  },
  'group.requestLoan': {
    target: 'group', fn: 'requestLoan', primaryType: 'RequestLoan', signerField: 'borrower',
    schema: s({ borrower: address, groupId: big, principal: big, duration: big, guarantors: z.array(address).max(10), pledges: z.array(big).max(10), nonce: big, deadline: big }),
    args: (p, sig) => [p.borrower, p.groupId, p.principal, p.duration, p.guarantors, p.pledges, p.nonce, p.deadline, sig],
  },
  'group.approveLoan': {
    target: 'group', fn: 'approveLoan', primaryType: 'ApproveLoan', signerField: 'member',
    schema: s({ member: address, loanId: big, nonce: big, deadline: big }),
    args: (p, sig) => [p.member, p.loanId, p.nonce, p.deadline, sig],
  },
  'group.cancelLoan': {
    target: 'group', fn: 'cancelLoan', primaryType: 'CancelLoan', signerField: 'borrower',
    schema: s({ borrower: address, loanId: big, nonce: big, deadline: big }),
    args: (p, sig) => [p.borrower, p.loanId, p.nonce, p.deadline, sig],
  },
  'group.repay': {
    target: 'group', fn: 'repay', primaryType: 'Repay', signerField: 'payer',
    schema: s({ payer: address, loanId: big, amount: big, nonce: big, deadline: big }),
    args: (p, sig) => [p.payer, p.loanId, p.amount, p.nonce, p.deadline, sig],
  },
  'group.requestGrant': {
    target: 'group', fn: 'requestGrant', primaryType: 'RequestGrant', signerField: 'member',
    schema: s({ member: address, groupId: big, amount: big, nonce: big, deadline: big }),
    args: (p, sig) => [p.member, p.groupId, p.amount, p.nonce, p.deadline, sig],
  },
  'group.approveGrant': {
    target: 'group', fn: 'approveGrant', primaryType: 'ApproveGrant', signerField: 'member',
    schema: s({ member: address, grantId: big, nonce: big, deadline: big }),
    args: (p, sig) => [p.member, p.grantId, p.nonce, p.deadline, sig],
  },
  'group.claimShareOut': {
    target: 'group', fn: 'claimShareOut', primaryType: 'ClaimShareOut', signerField: 'member',
    schema: s({ member: address, groupId: big, rollPocketId: big, nonce: big, deadline: big }),
    args: (p, sig) => [p.member, p.groupId, p.rollPocketId, p.nonce, p.deadline, sig],
  },
  // Permissionless: the contract checks every rule; the relayer only pays gas.
  'group.disburse': {
    target: 'group', fn: 'disburse', primaryType: null, signerField: null,
    schema: s({ loanId: big }), args: p => [p.loanId],
  },
  'group.markDefault': {
    target: 'group', fn: 'markDefault', primaryType: null, signerField: null,
    schema: s({ loanId: big }), args: p => [p.loanId],
  },
  // Gasless USDT approve via the token's executeMetaTransaction (Nimiq Pay pattern). Spender must be ours.
  'usdt.approve': {
    target: 'usdt', fn: 'executeMetaTransaction', primaryType: 'MetaTransaction', signerField: 'owner',
    schema: s({ owner: address, spender: address, amount: big, nonce: big }),
    args: () => [], // built in policy.ts (needs functionSignature + split signature)
  },
}

export const TYPES: Record<string, readonly { name: string, type: string }[]> = { ...vaultTypes, ...groupTypes }

export const usdtAbi = [
  { type: 'function', name: 'executeMetaTransaction', stateMutability: 'payable', inputs: [{ name: 'userAddress', type: 'address' }, { name: 'functionSignature', type: 'bytes' }, { name: 'sigR', type: 'bytes32' }, { name: 'sigS', type: 'bytes32' }, { name: 'sigV', type: 'uint8' }], outputs: [{ type: 'bytes' }] },
  { type: 'function', name: 'getNonce', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const satisfies Abi

export const ABIS: Record<Target, Abi> = { vault: PocketVaultAbi as Abi, group: GroupKittyAbi as Abi, usdt: usdtAbi }

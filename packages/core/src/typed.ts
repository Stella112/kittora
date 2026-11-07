// EIP-712 typed-data builders. Field order and names MUST match the typehashes in
// packages/contracts/src/{PocketVault,GroupKitty}.sol (checked by apps/relayer/test/typed.test.ts).
import type { Address, Hex } from 'viem'

export const CHAIN_ID = 137

export const VAULT_DOMAIN_NAME = 'Kittora PocketVault'
export const GROUP_DOMAIN_NAME = 'Kittora GroupKitty'

export const vaultTypes = {
  OpenPocket: [
    { name: 'owner', type: 'address' },
    { name: 'kind', type: 'uint8' },
    { name: 'unlockAt', type: 'uint64' },
    { name: 'target', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  Deposit: [
    { name: 'owner', type: 'address' },
    { name: 'pocketId', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  Withdraw: [
    { name: 'owner', type: 'address' },
    { name: 'pocketId', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'to', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  CreateMandate: [
    { name: 'owner', type: 'address' },
    { name: 'amountPerRun', type: 'uint256' },
    { name: 'interval', type: 'uint64' },
    { name: 'maxRuns', type: 'uint32' },
    { name: 'expiry', type: 'uint64' },
    { name: 'toGroup', type: 'bool' },
    { name: 'destId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  RevokeMandate: [
    { name: 'owner', type: 'address' },
    { name: 'mandateId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  LockBond: [
    { name: 'owner', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'unlockAt', type: 'uint64' },
    { name: 'nimiqAddress', type: 'bytes20' },
    { name: 'nimLuna', type: 'uint64' },
    { name: 'groupId', type: 'uint256' },
    { name: 'linkHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  ClaimBond: [
    { name: 'owner', type: 'address' },
    { name: 'bondId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export const groupTypes = {
  CreateGroup: [
    { name: 'creator', type: 'address' },
    { name: 'sharePrice', type: 'uint256' },
    { name: 'socialFundPerMeeting', type: 'uint256' },
    { name: 'meetingInterval', type: 'uint64' },
    { name: 'cycleEnd', type: 'uint64' },
    { name: 'gracePeriod', type: 'uint64' },
    { name: 'interestBps', type: 'uint16' },
    { name: 'maxLoanMultipleBps', type: 'uint16' },
    { name: 'maxSharesPerMeeting', type: 'uint8' },
    { name: 'approvalsRequired', type: 'uint8' },
    { name: 'maxMembers', type: 'uint16' },
    { name: 'maxSocialPayout', type: 'uint256' },
    { name: 'name', type: 'string' },
    { name: 'purpose', type: 'string' },
    { name: 'coverId', type: 'uint8' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  JoinGroup: [
    { name: 'member', type: 'address' },
    { name: 'groupId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  BuyShares: [
    { name: 'member', type: 'address' },
    { name: 'groupId', type: 'uint256' },
    { name: 'shares', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  RequestLoan: [
    { name: 'borrower', type: 'address' },
    { name: 'groupId', type: 'uint256' },
    { name: 'principal', type: 'uint256' },
    { name: 'duration', type: 'uint64' },
    { name: 'guarantors', type: 'address[]' },
    { name: 'pledges', type: 'uint256[]' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  ApproveLoan: [
    { name: 'member', type: 'address' },
    { name: 'loanId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  CancelLoan: [
    { name: 'borrower', type: 'address' },
    { name: 'loanId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  Repay: [
    { name: 'payer', type: 'address' },
    { name: 'loanId', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  UpdateProfile: [
    { name: 'admin', type: 'address' },
    { name: 'groupId', type: 'uint256' },
    { name: 'name', type: 'string' },
    { name: 'purpose', type: 'string' },
    { name: 'coverId', type: 'uint8' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  SetTreasurer: [
    { name: 'admin', type: 'address' },
    { name: 'groupId', type: 'uint256' },
    { name: 'member', type: 'address' },
    { name: 'enabled', type: 'bool' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  TransferAdmin: [
    { name: 'admin', type: 'address' },
    { name: 'groupId', type: 'uint256' },
    { name: 'newAdmin', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  RemoveMember: [
    { name: 'admin', type: 'address' },
    { name: 'groupId', type: 'uint256' },
    { name: 'member', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  ProposeSocialPayout: [
    { name: 'proposer', type: 'address' },
    { name: 'groupId', type: 'uint256' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'reason', type: 'string' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  ApproveSocialPayout: [
    { name: 'member', type: 'address' },
    { name: 'payoutId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  ClaimShareOut: [
    { name: 'member', type: 'address' },
    { name: 'groupId', type: 'uint256' },
    { name: 'rollPocketId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export type VaultPrimary = keyof typeof vaultTypes
export type GroupPrimary = keyof typeof groupTypes

export function vaultDomain(vault: Address, chainId = CHAIN_ID) {
  return { name: VAULT_DOMAIN_NAME, version: '1', chainId, verifyingContract: vault } as const
}

export function groupDomain(groupKitty: Address, chainId = CHAIN_ID) {
  return { name: GROUP_DOMAIN_NAME, version: '1', chainId, verifyingContract: groupKitty } as const
}

export function vaultTyped<P extends VaultPrimary>(vault: Address, primaryType: P, message: Record<string, unknown>, chainId = CHAIN_ID) {
  return { domain: vaultDomain(vault, chainId), types: { [primaryType]: vaultTypes[primaryType] }, primaryType, message }
}

export function groupTyped<P extends GroupPrimary>(gk: Address, primaryType: P, message: Record<string, unknown>, chainId = CHAIN_ID) {
  return { domain: groupDomain(gk, chainId), types: { [primaryType]: groupTypes[primaryType] }, primaryType, message }
}

// ---- USDT gasless approval (mirrors Nimiq Pay signTokenApproval, src/stores/polygon-usdt.ts @2115a8d) ----

export const USDT_POLYGON: Address = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'

/** tokenName must be read on-chain (`name()`), currently "USDT0". */
export function usdtMetaTxTyped(tokenName: string, from: Address, nonce: bigint, functionSignature: Hex, chainId = CHAIN_ID) {
  return {
    domain: {
      name: tokenName,
      version: '1',
      verifyingContract: USDT_POLYGON,
      salt: (`0x${chainId.toString(16).padStart(64, '0')}`) as Hex,
    },
    types: {
      MetaTransaction: [
        { name: 'nonce', type: 'uint256' },
        { name: 'from', type: 'address' },
        { name: 'functionSignature', type: 'bytes' },
      ],
    },
    primaryType: 'MetaTransaction' as const,
    message: { nonce, from, functionSignature },
  }
}

const DOMAIN_FIELDS: Record<string, { name: string, type: string }> = {
  name: { name: 'name', type: 'string' },
  version: { name: 'version', type: 'string' },
  chainId: { name: 'chainId', type: 'uint256' },
  verifyingContract: { name: 'verifyingContract', type: 'address' },
  salt: { name: 'salt', type: 'bytes32' },
}

/** JSON payload for `eth_signTypedData_v4` (adds EIP712Domain, stringifies bigints). */
export function toSignTypedDataV4(td: { domain: Record<string, unknown>, types: Record<string, readonly unknown[]>, primaryType: string, message: Record<string, unknown> }): string {
  const EIP712Domain = Object.keys(td.domain).map(k => DOMAIN_FIELDS[k])
  return JSON.stringify({ ...td, types: { EIP712Domain, ...td.types } }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

import { config } from '../config.ts'
import { makeError } from './errors.ts'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(config.relayerUrl + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  } catch (e) {
    throw makeError('rpc_down', String(e), 'We could not reach the Kittora relay. Check your connection and retry.')
  }
  const body = await res.json().catch(() => ({})) as T & { error?: string, message?: string }
  if (!res.ok) throw Object.assign(new Error(body.message ?? `HTTP ${res.status}`), { error: body.error ?? 'internal' })
  return body
}

/** One indexed contract event (args are JSON: bigints arrive as decimal strings). */
export interface ChainActivity { contract: 'vault' | 'group', event: string, args: Record<string, unknown>, hash: string, block: string, logIndex: number, ts?: number, stamp?: string }

/** /group/:id: ids the contract cannot enumerate, approvers, and the relayer's own tracking (A1.2 / A1.3). */
export interface GroupIndex {
  loanIds: string[]
  payoutIds: string[]
  mandateIds: string[]
  /** Meetings each member bought shares in (whole history) and when they (last) joined. */
  memberStats: Record<string, { paid: number[], joinedTs: number | null }>
  approvers: { loans: Record<string, string[]>, payouts: Record<string, string[]> }
  relays: { hash: string, action: string, signer: string, groupId: number | null, refId: number | null, status: 'submitted' | 'failed', createdAt: number }[]
  autosaveWindows: { key: string, mandateId: number, groupId: number, member: string, windowIdx: number, status: 'sent' | 'skipped' | 'failed', reason: string | null, txHash: string | null, updatedAt: number }[]
}

/** One group feed event (A1.2). `actor` is the initiator; "autosave" when the vault paid; absent if permissionless. */
export interface GroupFeedRow extends ChainActivity { groupId: string, actor?: string, ref?: string }

export const relayer = {
  challenge: () => call<{ nonce: string, message: string }>('/auth/challenge'),
  verify: (b: { nonce: string, message: string, address: string, publicKey: string, signature: string }) =>
    call<{ token: string, nimiqAddress: string }>('/auth/verify', { method: 'POST', body: JSON.stringify(b) }),
  me: (evm: string) => call<{ pocketIds: string[], groupIds: string[], bondIds: string[], mandateIds: string[] }>(`/me/${evm}`),
  group: (id: bigint) => call<GroupIndex>(`/group/${id}`),
  groupFeed: (id: bigint) => call<{ items: GroupFeedRow[], scannedTo: string }>(`/group/${id}/feed`),
  activity: (evm: string) => call<{ items: ChainActivity[] }>(`/activity/${evm}`),
  relay: (b: { action: string, params: Record<string, unknown>, signature?: string, nimiqLink?: unknown }) =>
    call<{ hash: `0x${string}`, status: 'pending' }>('/relay', { method: 'POST', body: JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) }),
  stamp: (polygonTx: string, nimiqTx: string) => call<{ status: 'stamped' | 'pending', nimiqTx: string, message?: string }>('/stamps', { method: 'POST', body: JSON.stringify({ polygonTx, nimiqTx }) }),
  status: (hash: string) => call<{ hash: string, status: 'pending' | 'confirmed' | 'failed', block?: number }>(`/status/${hash}`),
}

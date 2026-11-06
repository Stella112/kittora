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
export interface ChainActivity { contract: 'vault' | 'group', event: string, args: Record<string, unknown>, hash: string, block: string, logIndex: number, ts?: number }

export const relayer = {
  challenge: () => call<{ nonce: string, message: string }>('/auth/challenge'),
  verify: (b: { nonce: string, message: string, address: string, publicKey: string, signature: string }) =>
    call<{ token: string, nimiqAddress: string }>('/auth/verify', { method: 'POST', body: JSON.stringify(b) }),
  me: (evm: string) => call<{ pocketIds: string[], groupIds: string[], bondIds: string[], mandateIds: string[] }>(`/me/${evm}`),
  group: (id: bigint) => call<{ loanIds: string[], grantIds: string[] }>(`/group/${id}`),
  activity: (evm: string) => call<{ items: ChainActivity[] }>(`/activity/${evm}`),
  relay: (b: { action: string, params: Record<string, unknown>, signature?: string, nimiqLink?: unknown }) =>
    call<{ hash: `0x${string}`, status: 'pending' }>('/relay', { method: 'POST', body: JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) }),
  status: (hash: string) => call<{ hash: string, status: 'pending' | 'confirmed' | 'failed', block?: number }>(`/status/${hash}`),
}

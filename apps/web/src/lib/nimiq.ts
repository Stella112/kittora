// Nimiq Pay host detection + Nimiq provider (@nimiq/mini-app-sdk 0.2.5; surface verified in docs/SOURCES.md).
import { init, getHostNetwork, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { makeError } from './errors.ts'

let providerPromise: Promise<NimiqProvider> | null = null

/** True when Nimiq Pay has injected its host context or provider. */
export function hostInjected(): boolean {
  const w = window as unknown as { nimiqPay?: unknown, nimiq?: unknown }
  return Boolean(w.nimiqPay || w.nimiq)
}

export function nimiqProvider(): Promise<NimiqProvider> {
  providerPromise ??= init({ timeout: hostInjected() ? 8000 : 2500 }).catch((e) => {
    providerPromise = null
    throw makeError('not_in_nimiq_pay', String(e))
  })
  return providerPromise
}

/** 'testnet' shows the TESTNET badge (brief Rule 7). */
export function hostNetwork(): 'mainnet' | 'testnet' | undefined {
  return getHostNetwork()
}

/** Throws the SDK's ErrorResponse objects as real errors so classify() can read them. */
export function unwrap<T>(v: T | { error: unknown }): T {
  if (v && typeof v === 'object' && 'error' in (v as object)) {
    const e = (v as { error: { message?: string, code?: number } }).error
    throw Object.assign(new Error(e?.message ?? String(e)), { code: e?.code })
  }
  return v as T
}

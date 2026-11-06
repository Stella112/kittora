import type { Address } from 'viem'

const addr = (v: string | undefined) => (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : null)

export const config = {
  relayerUrl: (import.meta.env.VITE_RELAYER_URL as string | undefined) ?? 'http://localhost:8788',
  vault: addr(import.meta.env.VITE_VAULT_ADDRESS),
  groupKitty: addr(import.meta.env.VITE_GROUP_KITTY_ADDRESS),
  chainId: Number(import.meta.env.VITE_CHAIN_ID ?? 137),
  publicUrl: (import.meta.env.VITE_PUBLIC_URL as string | undefined) ?? window.location.origin,
}

export const contractsDeployed = () => config.vault !== null && config.groupKitty !== null

/** Verified in nimiq-pay-app src/lib/mini-app-deeplink.ts and src/lib/deep-link.ts (@52097644). */
export function openInNimiqPayLinks(url = config.publicUrl) {
  const u = new URL(url)
  const path = u.pathname === '/' ? '' : u.pathname
  return {
    universal: `https://nimpay.app/miniapps/open/${u.host}${path}${u.search}`,
    scheme: `nimiqpay://miniapp?url=${encodeURIComponent(url)}`,
  }
}

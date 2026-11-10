// The USDT you hold on Polygon in your Nimiq Pay wallet (outside Kittora's pockets), read live.
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { usdtBalance } from '../lib/chainActions.ts'
import { nimiqProvider, unwrap } from '../lib/nimiq.ts'
import { formatNim } from '../lib/amounts.ts'
import { config } from '../config.ts'
import { useSession } from '../state/session.tsx'
import { usdt } from './ui.tsx'

/** NIM in the Nimiq Pay wallet (SDK getBalance, in luna) and NIM actively staked (relayer, Nimiq RPC). */
export function useNimBalances(nimiqAddress: string | null) {
  const bal = useQuery({
    queryKey: ['nimBalance', nimiqAddress],
    // Nimiq Pay's own client first; if it is still syncing ("Nimiq network is not ready") or errors, read it via the relayer
    queryFn: async () => {
      try {
        const v = unwrap(await (await nimiqProvider()).getBalance(nimiqAddress!))
        if (typeof v === 'number') return v
      } catch { /* fall back below */ }
      const r = await fetch(`${config.relayerUrl}/nimiq/balance/${encodeURIComponent(nimiqAddress!)}`)
      if (!r.ok) throw new Error('NIM balance unavailable')
      return ((await r.json()) as { luna: number }).luna
    },
    enabled: Boolean(nimiqAddress), refetchInterval: 30_000, retry: 1,
  })
  const stake = useQuery({
    queryKey: ['nimStake', nimiqAddress],
    queryFn: async () => {
      const r = await fetch(`${config.relayerUrl}/nimiq/staker/${encodeURIComponent(nimiqAddress!)}`)
      if (!r.ok) throw new Error('stake unavailable')
      return (await r.json()) as { active: number, found: boolean }
    },
    enabled: Boolean(nimiqAddress), refetchInterval: 60_000, retry: 1,
  })
  return { available: bal.data, staked: stake.data?.active, error: bal.isError }
}

export function useWalletUsdt(evm: Address | null) {
  return useQuery({ queryKey: ['walletUsdt', evm], queryFn: () => usdtBalance(evm!), enabled: Boolean(evm), refetchInterval: 20_000 })
}

export function WalletBalance({ evm }: { evm: Address | null }) {
  const q = useWalletUsdt(evm)
  const { nimiqAddress } = useSession()
  const nim = useNimBalances(nimiqAddress)
  if (!evm) return null
  return (
    <div className="divide-y divide-line rounded-[22px] bg-surface ring-1 ring-line">
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-brand-strong">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM3 7l11-4 2 4M16 13.5h2" /></svg>
        </span>
        <div>
          <p className="text-sm font-extrabold text-ink">Wallet</p>
          <p className="text-xs text-muted">USDT on Polygon, ready to save</p>
        </div>
      </div>
      <p className="tabular text-lg font-black text-ink">{q.data !== undefined ? usdt(q.data) : '…'} <span className="text-xs font-bold text-muted">USDT</span></p>
    </div>
    {nimiqAddress && (
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-gold-soft text-[#7a5306]">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /></svg>
          </span>
          <div>
            <p className="text-sm font-extrabold text-ink">NIM</p>
            <p className="text-xs text-muted">{nim.staked ? `${formatNim(nim.staked)} NIM staked` : 'In your Nimiq Pay wallet'}</p>
          </div>
        </div>
        <p className="tabular text-lg font-black text-ink">{nim.available !== undefined ? formatNim(nim.available) : nim.error ? '—' : '…'} <span className="text-xs font-bold text-muted">NIM</span></p>
      </div>
    )}
    </div>
  )
}

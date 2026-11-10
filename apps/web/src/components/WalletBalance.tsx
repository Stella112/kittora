// The USDT you hold on Polygon in your Nimiq Pay wallet (outside Kittora's pockets), read live.
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { usdtBalance } from '../lib/chainActions.ts'
import { usdt } from './ui.tsx'

export function useWalletUsdt(evm: Address | null) {
  return useQuery({ queryKey: ['walletUsdt', evm], queryFn: () => usdtBalance(evm!), enabled: Boolean(evm), refetchInterval: 20_000 })
}

export function WalletBalance({ evm }: { evm: Address | null }) {
  const q = useWalletUsdt(evm)
  if (!evm) return null
  return (
    <div className="flex items-center justify-between rounded-[22px] bg-surface px-4 py-3 ring-1 ring-line">
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
  )
}

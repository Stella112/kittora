import { Link, Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { usePortfolio } from '../../lib/portfolio.ts'
import { aaveSupplyRateRay } from '../../lib/chainActions.ts'
import { rayToPct, formatNim } from '../../lib/amounts.ts'
import { classify } from '../../lib/errors.ts'
import { store } from '../../lib/storage.ts'
import { useState } from 'react'
import { Button, Card, ErrorPanel, Spinner, usdt } from '../../components/ui.tsx'
import { SavingsHero, useApr } from '../../components/SavingsHero.tsx'
import { AddMoneySheet, ProjectionCard, WithdrawSheet } from './AddMoney.tsx'
import { WalletBalance } from '../../components/WalletBalance.tsx'
import { RequireEvm } from '../../components/RequireEvm.tsx'
import { disclosureAccepted } from '../Disclosure.tsx'

export const KIND_NAMES = ['Flex', 'Target', 'SafeLock', 'Bond'] as const
export const pocketName = (id: bigint, kind: number) => store.get<string>(`pocketName:${id}`) ?? `${KIND_NAMES[kind]} #${id}`

export function RateBadge() {
  const q = useQuery({ queryKey: ['aaveRate'], queryFn: aaveSupplyRateRay, refetchInterval: 60_000 })
  return (
    <p className="text-sm text-muted">
      Earning <b className="text-ink">{q.data !== undefined ? rayToPct(q.data) : '…'} APR</b> right now from Aave. <b>Variable</b>: it changes and is not guaranteed.
    </p>
  )
}

export function Save() {
  if (!disclosureAccepted()) return <Navigate to="/disclosure?next=/save" replace />
  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-2xl">My Kitty</h1>
      <RequireEvm>{evm => <SaveBody evm={evm} />}</RequireEvm>
    </div>
  )
}

function SaveBody({ evm }: { evm: `0x${string}` }) {
  const q = usePortfolio(evm)
  const apr = useApr()
  const [sheet, setSheet] = useState(false)
  const [out, setOut] = useState(false)
  const now = BigInt(Math.floor(Date.now() / 1000))
  return (
    <>
      <SavingsHero evm={evm} p={q.data} title="My Kitty" total={q.data?.myKittyTotal} />
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => setSheet(true)}>Add money</Button>
        <Button variant="secondary" onClick={() => setOut(true)}>Withdraw</Button>
      </div>
      <WalletBalance evm={evm} />
      <AddMoneySheet open={sheet} onClose={() => setSheet(false)} />
      <WithdrawSheet open={out} onClose={() => setOut(false)} pockets={(q.data?.pockets ?? []).filter(p => p.kind !== 3)} />

      {q.isLoading && <Spinner label="Loading your pockets…" />}
      {q.error && <ErrorPanel error={classify(q.error)} onRetry={() => q.refetch()} compact />}
      {q.data && (
        <>
          <h2 className="pt-2 text-lg font-bold">Pockets</h2>
          {q.data.pockets.filter(p => p.kind !== 3).length === 0 && <Card><p className="text-muted">No pockets yet. Start with Flex to save and withdraw anytime.</p></Card>}
          {q.data.pockets.filter(p => p.kind !== 3).map((p) => {
            const pct = p.kind === 1 && p.target > 0n ? Number((p.assets * 100n) / p.target) : null
            return (
              <Link key={String(p.id)} to={`/save/pocket/${p.id}`} className="block">
                <Card>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-extrabold">{pocketName(p.id, p.kind)}</p>
                    <p className="tabular flex items-center gap-2 text-lg font-black">{usdt(p.assets)} <span className="text-sm font-bold text-muted">USDT</span>
                      <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-muted"><path d="m9 6 6 6-6 6" /></svg>
                    </p>
                  </div>
                  <p className="mt-1 text-xs font-bold text-brand-strong">Tap to add, withdraw or set up Autosave</p>
                  {pct !== null && (
                    <div className="mt-3">
                      <div className="h-2.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.min(pct, 100)} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                      <p className="mt-1 text-xs text-muted">{pct}% of {usdt(p.target)} USDT</p>
                    </div>
                  )}
                  {p.kind === 2 && <p className="mt-1 text-xs text-muted">{p.unlockAt > now ? `Locked until ${new Date(Number(p.unlockAt) * 1000).toLocaleDateString()}` : 'Unlocked'}</p>}
                </Card>
              </Link>
            )
          })}
          {q.data.bonds.length > 0 && <h2 className="pt-2 text-lg font-bold">NIM SafeLocks</h2>}
          {q.data.bonds.map(b => (
            <Link key={String(b.id)} to="/save/nim" className="block">
              <Card>
                <div className="flex items-baseline justify-between">
                  <p className="font-semibold">{formatNim(b.nimLuna)} NIM staked</p>
                  <p className="tabular font-bold">{usdt(b.assets)} USDT bond</p>
                </div>
                <p className="mt-1 text-xs text-muted">{['', 'Active', 'Claimed', 'Forfeited'][b.status]} · until {new Date(Number(b.unlockAt) * 1000).toLocaleDateString()}</p>
              </Card>
            </Link>
          ))}
        </>
      )}
      <ProjectionCard apr={apr} />
    </>
  )
}

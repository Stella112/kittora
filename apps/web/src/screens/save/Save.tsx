import { Link, Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { usePortfolio } from '../../lib/portfolio.ts'
import { aaveSupplyRateRay } from '../../lib/chainActions.ts'
import { rayToPct, formatNim } from '../../lib/amounts.ts'
import { classify } from '../../lib/errors.ts'
import { store } from '../../lib/storage.ts'
import { Card, ErrorPanel, Spinner, usdt } from '../../components/ui.tsx'
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
      <h1 className="text-2xl font-bold">My Kitty</h1>
      <RateBadge />
      <RequireEvm>{evm => <SaveBody evm={evm} />}</RequireEvm>
    </div>
  )
}

function SaveBody({ evm }: { evm: `0x${string}` }) {
  const q = usePortfolio(evm)
  const now = BigInt(Math.floor(Date.now() / 1000))
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {([['flex', 'Flex', 'Anytime'], ['target', 'Target', 'A goal'], ['safelock', 'SafeLock', 'Locked']] as const).map(([k, t, d]) => (
          <Link key={k} to={`/save/new/${k}`} className="flex min-h-20 flex-col items-center justify-center rounded-2xl bg-surface p-2 text-center shadow-sm">
            <span className="font-bold text-brand-strong">{t}</span>
            <span className="text-xs text-muted">{d}</span>
          </Link>
        ))}
      </div>
      <Link to="/save/nim" className="block rounded-2xl bg-brand-soft p-4">
        <p className="font-bold">NIM SafeLock</p>
        <p className="text-sm text-muted">Stake NIM in your own wallet and back your promise with a USDT bond.</p>
      </Link>

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
                  <div className="flex items-baseline justify-between">
                    <p className="font-semibold">{pocketName(p.id, p.kind)}</p>
                    <p className="tabular text-lg font-bold">{usdt(p.assets)} <span className="text-sm">USDT</span></p>
                  </div>
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
    </>
  )
}

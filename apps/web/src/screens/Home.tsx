import { useNavigate } from 'react-router'
import { useEffect, useState } from 'react'
import { useSession } from '../state/session.tsx'
import { usePortfolio } from '../lib/portfolio.ts'
import { contractsDeployed } from '../config.ts'
import { classify, makeError } from '../lib/errors.ts'
import { Button, Card, ErrorPanel, Spinner, usdt } from '../components/ui.tsx'
import { disclosureAccepted } from './Disclosure.tsx'

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function countdown(at: bigint, now: number) {
  let s = Math.max(0, Number(at) - now)
  const d = Math.floor(s / 86400); s -= d * 86400
  const h = Math.floor(s / 3600); s -= h * 3600
  const m = Math.floor(s / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`
}

export function Home() {
  const nav = useNavigate()
  const { evmAddress, connect, nimiqAddress } = useSession()
  const q = usePortfolio(evmAddress)
  const now = useNow()
  const goSave = () => nav(disclosureAccepted() ? '/save' : '/disclosure?next=/save')

  return (
    <div className="space-y-4 pt-2">
      <Card className="bg-gradient-to-br from-brand to-brand-strong text-white">
        <p className="text-sm/5 opacity-90">My Kitty</p>
        <p className="tabular mt-1 text-4xl font-extrabold">{q.data ? usdt(q.data.myKittyTotal) : '0.00'} <span className="text-lg font-semibold">USDT</span></p>
        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-sm/5 opacity-90">Group Kitty share</p>
            <p className="tabular text-xl font-bold">{q.data ? usdt(q.data.groupTotal) : '0.00'} USDT</p>
          </div>
          {q.data?.nextEvent && (
            <div className="text-right">
              <p className="text-sm/5 opacity-90">{q.data.nextEvent.label} in</p>
              <p className="tabular text-xl font-bold">{countdown(q.data.nextEvent.at, now)}</p>
            </div>
          )}
        </div>
      </Card>

      {!contractsDeployed() && <ErrorPanel error={makeError('not_deployed')} />}
      {contractsDeployed() && !evmAddress && (
        <Card>
          <p className="font-semibold">Connect your Polygon account</p>
          <p className="mt-1 text-sm text-muted">Dollars live on Polygon in your Nimiq Pay wallet. You never need POL: Kittora pays the fees.</p>
          <div className="mt-3"><Button variant="secondary" onClick={connect}>Connect</Button></div>
        </Card>
      )}
      {q.isLoading && <Spinner label="Reading your balances…" />}
      {q.error && <ErrorPanel error={classify(q.error)} onRetry={() => q.refetch()} compact />}

      <div className="grid grid-cols-1 gap-3">
        <Button onClick={goSave}>Save</Button>
        <Button variant="secondary" onClick={() => nav('/groups')}>Join or start a group</Button>
      </div>

      <Card>
        <h2 className="font-bold">How your group grows money</h2>
        <ol className="mt-3 space-y-2 text-sm text-muted">
          <li><b className="text-ink">1. Buy shares</b> at each meeting. Your savings are your shares.</li>
          <li><b className="text-ink">2. Members borrow</b> from the Group Kitty with guarantors, and repay with interest.</li>
          <li><b className="text-ink">3. Share-Out</b>: everyone gets their savings plus a share of the interest.</li>
        </ol>
      </Card>

      {nimiqAddress && <p className="text-center text-xs text-muted">Signed in as {nimiqAddress}</p>}
    </div>
  )
}

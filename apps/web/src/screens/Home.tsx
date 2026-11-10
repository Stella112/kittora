import { useNavigate } from 'react-router'
import { useEffect, useState } from 'react'
import { useSession } from '../state/session.tsx'
import { usePortfolio } from '../lib/portfolio.ts'
import { contractsDeployed } from '../config.ts'
import { classify, makeError } from '../lib/errors.ts'
import { Button, Card, ErrorPanel, Spinner, usdt } from '../components/ui.tsx'
import { SavingsHero } from '../components/SavingsHero.tsx'
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

  const total = q.data ? q.data.myKittyTotal + q.data.groupTotal : 0n
  return (
    <div className="space-y-4 pt-1">
      <div>
        <p className="text-[26px] font-black leading-tight text-ink">save alone, <span className="text-brand">grow together.</span></p>
        <p className="mt-1 text-sm text-muted">Your savings and your group, in dollars, inside Nimiq Pay.</p>
      </div>

      <SavingsHero evm={evmAddress} p={q.data} total={total} />
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[22px] bg-surface p-3 ring-1 ring-line">
          <p className="text-xs font-bold text-muted">My Kitty</p>
          <p className="tabular text-lg font-black">{q.data ? usdt(q.data.myKittyTotal) : '0.00'}</p>
        </div>
        <div className="rounded-[22px] bg-surface p-3 ring-1 ring-line">
          <p className="text-xs font-bold text-muted">{q.data?.nextEvent ? `${q.data.nextEvent.label} in ${countdown(q.data.nextEvent.at, now)}` : 'Group share'}</p>
          <p className="tabular text-lg font-black">{q.data ? usdt(q.data.groupTotal) : '0.00'}</p>
        </div>
      </div>

      {!contractsDeployed() && <ErrorPanel error={makeError('not_deployed')} />}
      {contractsDeployed() && !evmAddress && (
        <Card>
          <p className="font-extrabold">Connect your Polygon account</p>
          <p className="mt-1 text-sm text-muted">Dollars live on Polygon in your Nimiq Pay wallet. You never need POL: Kittora pays the fees.</p>
          <div className="mt-3"><Button onClick={connect}>Connect</Button></div>
        </Card>
      )}
      {q.isLoading && <Spinner label="Reading your balances…" />}
      {q.error && <ErrorPanel error={classify(q.error)} onRetry={() => q.refetch()} compact />}

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={goSave} className="rounded-[24px] bg-gold-soft p-4 text-left ring-1 ring-line transition active:scale-[0.98]">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-gold text-[#3b2a06]" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <p className="mt-3 font-extrabold text-ink">Save</p>
          <p className="text-xs text-muted">Pockets that earn</p>
        </button>
        <button type="button" onClick={() => nav('/groups')} className="rounded-[24px] bg-pink-soft p-4 text-left ring-1 ring-line transition active:scale-[0.98]">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-pink text-[#5a1830]" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm10 0a4 4 0 1 0 0-8M2 21v-2a5 5 0 0 1 5-5h0a5 5 0 0 1 5 5v2m4-7a5 5 0 0 1 6 5v2" /></svg>
          </span>
          <p className="mt-3 font-extrabold text-ink">Group Kitty</p>
          <p className="text-xs text-muted">Join or start one</p>
        </button>
      </div>

      <Card>
        <h2 className="font-extrabold">How your group grows money</h2>
        <ol className="mt-3 space-y-3">
          {[
            ['Buy shares', 'at each meeting. Your savings are your shares.', 'bg-gold text-[#3b2a06]'],
            ['Members borrow', 'from the Group Kitty with guarantors, and repay with interest.', 'bg-pink text-[#5a1830]'],
            ['Share-Out', 'everyone gets their savings plus a share of the interest.', 'bg-mint text-brand-strong'],
          ].map(([t, d, c], i) => (
            <li key={t} className="flex items-start gap-3">
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-black ${c}`}>{i + 1}</span>
              <p className="text-sm text-muted"><b className="text-ink">{t}</b> {d}</p>
            </li>
          ))}
        </ol>
      </Card>

      {nimiqAddress && <p className="text-center text-xs text-muted">Signed in as {nimiqAddress}</p>}
    </div>
  )
}

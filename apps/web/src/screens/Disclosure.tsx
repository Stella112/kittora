import { useNavigate, useSearchParams } from 'react-router'
import { useState } from 'react'
import { store } from '../lib/storage.ts'
import { Button, Card } from '../components/ui.tsx'

export const DISCLOSURE_VERSION = 1
export const disclosureAccepted = () => (store.get<number>('disclosure') ?? 0) >= DISCLOSURE_VERSION

/** Shown before the first deposit (brief §4.1 item 7). */
export function Disclosure() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [checked, setChecked] = useState(false)
  const next = params.get('next') ?? '/save'
  const items = [
    ['Yield is variable', 'Pockets earn the Aave V3 USDT rate. It changes all the time and can go down. Nothing is guaranteed.'],
    ['Smart-contract risk', 'Your money sits in Kittora and Aave smart contracts on Polygon. Bugs or failures could cause loss. The contracts have tests and a review but no external audit.'],
    ['Pilot amounts', 'This is a pilot. Contracts cap deposits at 25 USDT each, 100 USDT per person, and 500 USDT per group pool.'],
    ['NIM SafeLock is a bond, not a lock', 'Your NIM stays staked in your own wallet; Kittora cannot move it. You add a USDT bond. If your active stake drops below the amount before the date, the bond goes to your group social fund (or is burned if you have no group). An attester key run by Kittora reports this and publishes the Nimiq transaction as evidence: that is a trust assumption.'],
    ['Loan default rule', 'If a loan is not repaid by its due date plus the grace period, the unpaid amount is taken from the borrower\'s shares first, then from the guarantors\' pledged shares. Other members are never touched.'],
    ['Gas and relay', 'Kittora pays the network fees. Our relay only submits what you sign; it cannot move your funds without your signature.'],
  ]
  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-2xl font-bold">Before your first deposit</h1>
      <Card className="space-y-4">
        {items.map(([t, d]) => (
          <div key={t}>
            <h2 className="font-semibold">{t}</h2>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </div>
        ))}
      </Card>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl bg-surface p-4">
        <input type="checkbox" className="h-6 w-6 accent-[var(--color-brand)]" checked={checked} onChange={e => setChecked(e.target.checked)} />
        <span>I understand these risks.</span>
      </label>
      <Button disabled={!checked} onClick={() => { store.set('disclosure', DISCLOSURE_VERSION); nav(next, { replace: true }) }}>Continue</Button>
    </div>
  )
}

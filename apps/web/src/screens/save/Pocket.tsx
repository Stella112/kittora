import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import { usePortfolio, type MandateView, type PocketView } from '../../lib/portfolio.ts'
import { parseUsdt } from '../../lib/amounts.ts'
import { allowanceOf, deadline, signAndRelayVault, usdtBalance, VAULT, vaultNonce } from '../../lib/chainActions.ts'
import { approveStep, setAllowanceStep } from '../../lib/steps.ts'
import { classify, makeError } from '../../lib/errors.ts'
import { Button, Card, ErrorPanel, Hero, Spinner, usdt } from '../../components/ui.tsx'
import { RequireEvm } from '../../components/RequireEvm.tsx'
import { TxFlow, type Summary, type TxStep } from '../../components/TxFlow.tsx'
import { Field } from './NewPocket.tsx'
import { pocketName, RateBadge } from './Save.tsx'

type Flow = { summary: Summary, steps: TxStep[] } | null

export function Pocket() {
  return <div className="space-y-4 pt-2"><RequireEvm>{evm => <PocketBody evm={evm} />}</RequireEvm></div>
}

function PocketBody({ evm }: { evm: Address }) {
  const { id } = useParams()
  const q = usePortfolio(evm)
  const qc = useQueryClient()
  const [flow, setFlow] = useState<Flow>(null)
  const done = async () => { setFlow(null); await qc.invalidateQueries({ queryKey: ['portfolio'] }) }

  if (q.isLoading) return <Spinner label="Loading pocket…" />
  if (q.error) return <ErrorPanel error={classify(q.error)} onRetry={() => q.refetch()} />
  const p = q.data?.pockets.find(x => String(x.id) === id && x.kind !== 3)
  if (!p) return <ErrorPanel error={makeError('blocked', undefined, 'This pocket was not found for your account.')} />
  if (flow) return <TxFlow owner={evm} summary={flow.summary} steps={flow.steps} onDone={done} onCancel={() => setFlow(null)} />

  const mandates = q.data!.mandates.filter(m => !m.toGroup && m.destId === p.id)
  return (
    <>
      <Link to="/save" className="text-sm font-semibold text-brand-strong">← My Kitty</Link>
      <Header p={p} />
      <RateBadge />
      <DepositCard evm={evm} p={p} start={setFlow} />
      <WithdrawCard evm={evm} p={p} start={setFlow} />
      <AutosaveCard evm={evm} p={p} mandates={mandates} start={setFlow} />
    </>
  )
}

function Header({ p }: { p: PocketView }) {
  const now = BigInt(Math.floor(Date.now() / 1000))
  const pct = p.kind === 1 && p.target > 0n ? Number((p.assets * 100n) / p.target) : null
  return (
    <Hero>
      <p className="text-sm opacity-90">{pocketName(p.id, p.kind)}</p>
      <p className="tabular mt-1 text-4xl font-extrabold">{usdt(p.assets)} <span className="text-lg">USDT</span></p>
      {pct !== null && (
        <div className="mt-3">
          <div className="h-2.5 overflow-hidden rounded-full bg-white/30"><div className="h-full rounded-full bg-white" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
          <p className="mt-1 text-sm opacity-90">{pct}% of your {usdt(p.target)} USDT goal</p>
        </div>
      )}
      {p.kind === 2 && <p className="mt-2 text-sm opacity-90">{p.unlockAt > now ? `Locked until ${new Date(Number(p.unlockAt) * 1000).toLocaleString()}` : 'Unlocked: you can withdraw'}</p>}
    </Hero>
  )
}

function DepositCard({ evm, p, start }: { evm: Address, p: PocketView, start: (f: Flow) => void }) {
  const [v, setV] = useState('')
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    setErr(null)
    const a = parseUsdt(v)
    if (!a) return setErr('Enter an amount like 5 or 2.50')
    if (a > 25_000_000n) return setErr('Pilot limit: up to 25 USDT per deposit.')
    const bal = await usdtBalance(evm).catch(() => null)
    if (bal !== null && bal < a) return setErr(`You have ${usdt(bal)} USDT on Polygon.`)
    start({
      summary: { what: `Deposit into ${pocketName(p.id, p.kind)}`, amount: `${usdt(a)} USDT`, chain: 'Polygon', extra: [['Yield', 'Variable, not guaranteed']] },
      steps: [approveStep(evm, a), {
        label: `Deposit ${usdt(a)} USDT`, chain: 'polygon',
        run: async () => signAndRelayVault('vault.deposit', 'Deposit', evm, { owner: evm, pocketId: p.id, amount: a, nonce: await vaultNonce(evm), deadline: deadline() }),
      }],
    })
  }
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Add money</h2>
      <Field label="Amount (USDT)"><input className="input" inputMode="decimal" value={v} onChange={e => setV(e.target.value)} placeholder="5" /></Field>
      {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
      <Button onClick={go}>Deposit</Button>
    </Card>
  )
}

function WithdrawCard({ evm, p, start }: { evm: Address, p: PocketView, start: (f: Flow) => void }) {
  const [v, setV] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const now = BigInt(Math.floor(Date.now() / 1000))
  const locked = p.kind === 2 && p.unlockAt > now
  function go(all: boolean) {
    setErr(null)
    const a = all ? 2n ** 256n - 1n : parseUsdt(v)
    if (!a) return setErr('Enter an amount like 5 or 2.50')
    if (!all && a > p.assets) return setErr(`This pocket holds ${usdt(p.assets)} USDT.`)
    start({
      summary: { what: `Withdraw from ${pocketName(p.id, p.kind)} to your wallet`, amount: all ? `All (${usdt(p.assets)} USDT incl. yield)` : `${usdt(a)} USDT`, chain: 'Polygon', extra: [['To', `${evm.slice(0, 6)}…${evm.slice(-4)} (you)`]] },
      steps: [{
        label: 'Withdraw', chain: 'polygon',
        run: async () => signAndRelayVault('vault.withdraw', 'Withdraw', evm, { owner: evm, pocketId: p.id, amount: a, to: evm, nonce: await vaultNonce(evm), deadline: deadline() }),
      }],
    })
  }
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Withdraw</h2>
      {locked
        ? <ErrorPanel error={makeError('blocked', undefined, `This SafeLock is locked by the contract until ${new Date(Number(p.unlockAt) * 1000).toLocaleString()}. There is no early exit.`)} />
        : (
          <>
            <Field label="Amount (USDT)"><input className="input" inputMode="decimal" value={v} onChange={e => setV(e.target.value)} placeholder="5" /></Field>
            {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => go(false)}>Withdraw</Button>
              <Button variant="secondary" onClick={() => go(true)} disabled={p.assets === 0n}>Withdraw all</Button>
            </div>
          </>
        )}
    </Card>
  )
}

const INTERVALS = [['Every hour (pilot)', 3600], ['Every day', 86400], ['Every week', 604800], ['Every 30 days', 2592000]] as const

function AutosaveCard({ evm, p, mandates, start }: { evm: Address, p: PocketView, mandates: MandateView[], start: (f: Flow) => void }) {
  const [amt, setAmt] = useState('')
  const [interval, setInterval] = useState(86400)
  const [runs, setRuns] = useState('4')
  const [err, setErr] = useState<string | null>(null)
  const now = BigInt(Math.floor(Date.now() / 1000))

  function create() {
    setErr(null)
    const a = parseUsdt(amt)
    const n = Number(runs)
    if (!a) return setErr('Enter an amount per run.')
    if (a > 25_000_000n) return setErr('Pilot limit: up to 25 USDT per run.')
    if (!Number.isInteger(n) || n < 1 || n > 100) return setErr('Choose 1 to 100 runs.')
    const total = a * BigInt(n)
    const expiry = now + BigInt(interval) * BigInt(n) + 86400n
    start({
      summary: {
        what: `Autosave into ${pocketName(p.id, p.kind)}`, amount: `${usdt(a)} USDT × ${n} runs = ${usdt(total)} USDT max`, chain: 'Polygon',
        extra: [['How often', INTERVALS.find(i => i[1] === interval)![0]], ['Stops after', new Date(Number(expiry) * 1000).toLocaleDateString()], ['Cancel', 'Anytime, instantly']],
      },
      steps: [
        approveStep(evm, total),
        {
          label: 'Create the Autosave', chain: 'polygon',
          run: async () => signAndRelayVault('vault.createMandate', 'CreateMandate', evm, { owner: evm, amountPerRun: a, interval: BigInt(interval), maxRuns: n, expiry, toGroup: false, destId: p.id, nonce: await vaultNonce(evm), deadline: deadline() }),
        },
      ],
    })
  }

  function revoke(m: MandateView) {
    start({
      summary: { what: 'Stop this Autosave and remove Kittora\'s USDT allowance', chain: 'Polygon', extra: [['Effect', 'No further runs. Allowance reset to 0 (other Autosaves will need a new approval).']] },
      steps: [
        { label: 'Stop the Autosave', chain: 'polygon', run: async () => signAndRelayVault('vault.revokeMandate', 'RevokeMandate', evm, { owner: evm, mandateId: m.id, nonce: await vaultNonce(evm), deadline: deadline() }) },
        { ...setAllowanceStep(evm, 0n, 'Reset the USDT allowance to 0'), skip: async () => (await allowanceOf(evm, VAULT())) === 0n },
      ],
    })
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Autosave</h2>
      {mandates.map(m => {
        const active = !m.revoked && m.runs < m.maxRuns && m.expiry >= now
        const next = m.runs === 0 ? 'soon' : new Date(Number(m.lastRun + m.interval) * 1000).toLocaleString()
        return (
          <div key={String(m.id)} className="rounded-2xl bg-canvas p-3 text-sm">
            <p className="font-semibold">{usdt(m.amountPerRun)} USDT · run {m.runs} of {m.maxRuns}</p>
            <p className="text-muted">{active ? `Next run: ${next}` : m.revoked ? 'Stopped' : 'Finished'}</p>
            {active && <div className="mt-2"><Button variant="secondary" onClick={() => revoke(m)}>Stop</Button></div>}
          </div>
        )
      })}
      <Field label="Amount per run (USDT)"><input className="input" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} placeholder="2" /></Field>
      <Field label="How often">
        <select className="input" value={interval} onChange={e => setInterval(Number(e.target.value))}>
          {INTERVALS.map(([l, s]) => <option key={s} value={s}>{l}</option>)}
        </select>
      </Field>
      <Field label="Number of runs"><input className="input" inputMode="numeric" value={runs} onChange={e => setRuns(e.target.value)} /></Field>
      {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
      <Button variant="secondary" onClick={create}>Set up Autosave</Button>
    </Card>
  )
}

// Approval screen + three transaction states (brief §7): pending (explorer link) → confirmed | failed (reason + retry).
import { useState, type ReactNode } from 'react'
import type { Hex } from 'viem'
import { Button, Card, ErrorPanel, Spinner } from './ui.tsx'
import { classify, type AppError } from '../lib/errors.ts'
import { polygonscanTx, nimiqTx, waitConfirmed } from '../lib/chainActions.ts'
import { hostNetwork } from '../lib/nimiq.ts'
import { logActivity } from '../lib/activity.ts'

export interface TxStep {
  label: string
  chain: 'polygon' | 'nimiq'
  /** Returns the tx hash. Polygon steps are then awaited until the receipt confirms. */
  run: () => Promise<string>
  /** Optional custom confirmation (e.g. wait until the Nimiq stake is visible). */
  confirm?: (hash: string) => Promise<void>
  skip?: () => Promise<boolean>
}

export interface Summary {
  what: string
  amount?: string
  chain: string
  extra?: [string, ReactNode][]
}

type Phase = { k: 'review' } | { k: 'running', i: number, hash?: string } | { k: 'done', hashes: { chain: string, hash: string }[] } | { k: 'failed', i: number, error: AppError, hash?: string }

export function TxFlow({ summary, steps, onDone, onCancel, owner, doneText = 'Done' }: {
  summary: Summary
  steps: TxStep[]
  onDone: () => void
  onCancel: () => void
  owner: string
  doneText?: string
}) {
  const [phase, setPhase] = useState<Phase>({ k: 'review' })
  const [hashes, setHashes] = useState<{ chain: string, hash: string }[]>([])
  const testnet = hostNetwork() === 'testnet'
  const link = (chain: string, h: string) => (chain === 'nimiq' ? nimiqTx(h, testnet) : polygonscanTx(h))

  async function start(from = 0) {
    const done = [...hashes.slice(0, from)]
    for (let i = from; i < steps.length; i++) {
      const s = steps[i]
      let hash: string | undefined
      try {
        if (s.skip && await s.skip()) continue
        setPhase({ k: 'running', i })
        hash = await s.run()
        setPhase({ k: 'running', i, hash })
        logActivity(owner, { label: s.label, chain: s.chain, hash, status: 'pending' })
        if (s.confirm) await s.confirm(hash)
        else if (s.chain === 'polygon') await waitConfirmed(hash as Hex)
        logActivity(owner, { label: s.label, chain: s.chain, hash, status: 'confirmed' })
        done.push({ chain: s.chain, hash })
        setHashes([...done])
      } catch (e) {
        const error = classify(e)
        if (hash && error.kind !== 'pending') logActivity(owner, { label: s.label, chain: s.chain, hash, status: 'failed' })
        setPhase({ k: 'failed', i, error, hash })
        return
      }
    }
    setPhase({ k: 'done', hashes: done })
  }

  if (phase.k === 'review') {
    return (
      <Card className="space-y-4">
        <h2 className="text-xl font-bold">Review and sign</h2>
        <dl className="space-y-2 text-[15px]">
          <Row k="You are signing" v={summary.what} />
          {summary.amount && <Row k="Amount" v={<b className="tabular">{summary.amount}</b>} />}
          <Row k="Chain" v={summary.chain} />
          {summary.extra?.map(([k, v]) => <Row key={k} k={k} v={v} />)}
          <Row k="Network fee" v={<span className="font-semibold text-good">Covered by Kittora</span>} />
        </dl>
        {steps.length > 1 && (
          <div className="rounded-2xl bg-brand-soft p-3 text-sm">
            <p className="font-semibold">Nimiq Pay will ask you {steps.length === 2 ? 'twice' : `${steps.length} times`}:</p>
            <ol className="mt-1 list-decimal pl-5">{steps.map(s => <li key={s.label}>{s.label}</li>)}</ol>
          </div>
        )}
        <Button onClick={() => start(0)}>Sign in Nimiq Pay</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </Card>
    )
  }

  if (phase.k === 'running') {
    return (
      <Card className="space-y-3">
        <Spinner label={phase.hash ? `Confirming: ${steps[phase.i].label}` : `Waiting for your signature: ${steps[phase.i].label}`} />
        {phase.hash && <a className="block text-sm font-semibold text-brand-strong underline" href={link(steps[phase.i].chain, phase.hash)} target="_blank" rel="noreferrer">Pending: view on explorer</a>}
        <p className="text-sm text-muted">Step {phase.i + 1} of {steps.length}. Keep this screen open.</p>
      </Card>
    )
  }

  if (phase.k === 'failed') {
    return (
      <div className="space-y-3">
        <ErrorPanel
          error={phase.error}
          onRetry={phase.error.kind === 'pending' && phase.hash
            ? async () => { try { await waitConfirmed(phase.hash as Hex); setHashes(h => [...h, { chain: steps[phase.i].chain, hash: phase.hash! }]); await start(phase.i + 1) } catch (e) { setPhase({ ...phase, error: classify(e) }) } }
            : () => start(phase.i)}
        />
        {phase.hash && <a className="block text-sm font-semibold text-brand-strong underline" href={link(steps[phase.i].chain, phase.hash)} target="_blank" rel="noreferrer">View transaction</a>}
        <Button variant="ghost" onClick={onCancel}>Close</Button>
      </div>
    )
  }

  return (
    <Card className="space-y-3">
      <p className="text-xl font-bold text-good">Confirmed</p>
      <ul className="space-y-1 text-sm">
        {phase.hashes.map(h => <li key={h.hash}><a className="font-semibold text-brand-strong underline" href={link(h.chain, h.hash)} target="_blank" rel="noreferrer">{h.chain === 'nimiq' ? 'Nimiq' : 'Polygonscan'}: {h.hash.slice(0, 10)}…</a></li>)}
      </ul>
      <Button onClick={onDone}>{doneText}</Button>
    </Card>
  )
}

function Row({ k, v }: { k: string, v: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  )
}

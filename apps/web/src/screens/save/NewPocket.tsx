import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { decodeEventLog, type Abi, type Address, type Hex } from 'viem'
import { useQueryClient } from '@tanstack/react-query'
import { PocketVaultAbi } from '@kittora/core'
import { parseUsdt } from '../../lib/amounts.ts'
import { deadline, signAndRelayVault, usdtBalance, vaultNonce } from '../../lib/chainActions.ts'
import { reader } from '../../lib/evm.ts'
import { approveStep } from '../../lib/steps.ts'
import { store } from '../../lib/storage.ts'
import { makeError } from '../../lib/errors.ts'
import { Button, Card, ErrorPanel, usdt } from '../../components/ui.tsx'
import { RequireEvm } from '../../components/RequireEvm.tsx'
import { TxFlow, type TxStep } from '../../components/TxFlow.tsx'
import { RateBadge } from './Save.tsx'

const KINDS = { flex: 0, target: 1, safelock: 2 } as const
const TITLES = ['Flex', 'Target', 'SafeLock']
const BLURB = [
  'Save and withdraw anytime. Earns the variable Aave rate.',
  'Name a goal and an amount, and watch your progress. Withdraw anytime.',
  'Locked by the contract until your date. There is no early exit, not even for us.',
]

export function NewPocket() {
  const { kind: k } = useParams()
  const kind = KINDS[k as keyof typeof KINDS] ?? 0
  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-2xl font-bold">New {TITLES[kind]}</h1>
      <p className="text-muted">{BLURB[kind]}</p>
      <RateBadge />
      <RequireEvm>{evm => <Form evm={evm} kind={kind} />}</RequireEvm>
    </div>
  )
}

function Form({ evm, kind }: { evm: Address, kind: number }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [target, setTarget] = useState('')
  const [days, setDays] = useState('30')
  const [err, setErr] = useState<string | null>(null)
  const openedRef = useRef<Hex | null>(null)
  const [flow, setFlow] = useState<{ steps: TxStep[], amount: bigint, unlockAt: bigint, target: bigint } | null>(null)

  async function review() {
    setErr(null)
    const a = parseUsdt(amount)
    if (!a) return setErr('Enter an amount like 5 or 2.50')
    if (a > 25_000_000n) return setErr('Pilot limit: up to 25 USDT per deposit.')
    const bal = await usdtBalance(evm).catch(() => null)
    if (bal !== null && bal < a) return setErr(`You have ${usdt(bal)} USDT on Polygon.`)
    const t = kind === 1 ? parseUsdt(target) : 0n
    if (kind === 1 && !t) return setErr('Enter your goal amount.')
    const d = Number(days)
    if (kind === 2 && (!Number.isInteger(d) || d < 1 || d > 3650)) return setErr('Choose 1 to 3650 days.')
    const unlockAt = kind === 2 ? BigInt(Math.floor(Date.now() / 1000) + d * 86400) : 0n
    setFlow({
      amount: a, unlockAt, target: t!,
      steps: [
        approveStep(evm, a),
        {
          label: `Open your ${TITLES[kind]} and deposit ${usdt(a)} USDT`,
          chain: 'polygon',
          run: async () => {
            const nonce = await vaultNonce(evm)
            openedRef.current = await signAndRelayVault('vault.openPocket', 'OpenPocket', evm, { owner: evm, kind, unlockAt, target: t!, amount: a, nonce, deadline: deadline() })
            return openedRef.current
          },
        },
      ],
    })
  }

  async function finish(hashes: Hex | null) {
    // Remember the pocket's display name (per-viewer convenience) from the PocketOpened event.
    try {
      if (hashes && name.trim()) {
        const rc = await reader().getTransactionReceipt({ hash: hashes })
        for (const l of rc.logs) {
          try {
            const ev = decodeEventLog({ abi: PocketVaultAbi as Abi, data: l.data, topics: l.topics }) as unknown as { eventName: string, args: { pocketId: bigint } }
            if (ev.eventName === 'PocketOpened') store.set(`pocketName:${ev.args.pocketId}`, name.trim().slice(0, 40))
          } catch { /* other events */ }
        }
      }
    } catch { /* name is optional */ }
    await qc.invalidateQueries({ queryKey: ['portfolio'] })
    nav('/save')
  }

  if (flow) {
    return (
      <TxFlow
        owner={evm}
        summary={{
          what: `Open a ${TITLES[kind]} pocket and deposit`,
          amount: `${usdt(flow.amount)} USDT`,
          chain: 'Polygon',
          extra: [
            ...(kind === 1 ? [['Goal', `${usdt(flow.target)} USDT`] as [string, string]] : []),
            ...(kind === 2 ? [['Locked until', new Date(Number(flow.unlockAt) * 1000).toLocaleString()] as [string, string], ['Early exit', 'Not possible'] as [string, string]] : []),
            ['Yield', 'Variable Aave rate, not guaranteed'],
          ],
        }}
        steps={flow.steps}
        onDone={() => finish(openedRef.current)}
        onCancel={() => setFlow(null)}
      />
    )
  }

  return (
    <Card className="space-y-4">
      {kind !== 0 && (
        <Field label="Name (optional)">
          <input className="input" value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder={kind === 1 ? 'School fees' : 'Rent'} />
        </Field>
      )}
      {kind === 1 && (
        <Field label="Goal (USDT)">
          <input className="input" inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} placeholder="100" />
        </Field>
      )}
      {kind === 2 && (
        <Field label="Lock for (days)">
          <input className="input" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} />
        </Field>
      )}
      <Field label="First deposit (USDT)">
        <input className="input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="5" />
      </Field>
      {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
      <Button onClick={review}>Review</Button>
    </Card>
  )
}

export function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      {children}
    </label>
  )
}

// A1.2: pending approvals that need me, pinned at the top of the group screen with a working button.
import { useState } from 'react'
import type { Address } from 'viem'
import type { GroupDetail } from '../../lib/group.ts'
import { pendingForMe } from '../../lib/groupFeed.ts'
import { makeError } from '../../lib/errors.ts'
import { Button, Card, ErrorPanel, usdt } from '../../components/ui.tsx'
import { loanApproveFlow, loanPayoutFlow } from './Loans.tsx'
import { payoutApproveFlow, payoutExecuteFlow } from './SocialFund.tsx'
import type { Start } from './Group.tsx'

export function Pinned({ g, evm, start, startNoMoney }: { g: GroupDetail, evm: Address, start: Start, startNoMoney: Start }) {
  const [err, setErr] = useState<string | null>(null)
  const items = pendingForMe(g, evm)
  if (items.length === 0) return null

  function act(i: (typeof items)[number]) {
    setErr(null)
    if (i.kind === 'loan') {
      const l = g.loans.find(x => x.id === i.id)!
      if (i.action === 'payout') {
        const r = loanPayoutFlow(evm, g, l)
        if (r && 'error' in r) return setErr(r.error)
        return startNoMoney(r)
      }
      const r = loanApproveFlow(evm, g, l)
      if ('error' in r) return setErr(r.error)
      return (r.guarantor ? start : startNoMoney)(r.flow)
    }
    const po = g.payouts.find(x => x.id === i.id)!
    return startNoMoney(i.action === 'execute' ? payoutExecuteFlow(evm, po) : payoutApproveFlow(evm, g, po))
  }

  const label = (a: (typeof items)[number]['action']) => (a === 'guarantee' ? 'Guarantee' : a === 'payout' ? 'Pay out' : a === 'execute' ? 'Pay it' : 'Approve')
  return (
    <Card className="space-y-3 ring-2 ring-brand">
      <h2 className="font-bold">Needs you</h2>
      <ul className="space-y-2">
        {items.map(i => (
          <li key={`${i.kind}:${i.id}:${i.action}`} className="flex items-center justify-between gap-3 rounded-2xl bg-canvas p-3">
            <div className="min-w-0 text-sm">
              <p className="break-words font-semibold">{i.title}</p>
              <p className="tabular text-muted">{usdt(i.amount)} USDT{i.officer ? ' · your approval is the one it is waiting for' : ''}</p>
            </div>
            <div className="w-32 shrink-0"><Button onClick={() => act(i)}>{label(i.action)}</Button></div>
          </li>
        ))}
      </ul>
      {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
    </Card>
  )
}

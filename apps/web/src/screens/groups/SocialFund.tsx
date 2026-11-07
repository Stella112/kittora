// A1.5: social fund payments. Any member proposes a payment to a current member; others approve (never the proposer or
// the recipient), including a Treasurer, or the Admin while the group has none; then anyone pays it out. Only the social
// fund moves: the main pool is never spendable.
import { useState } from 'react'
import type { Address } from 'viem'
import { byteLen, canApprovePayout, officerNeeded, payoutExpired, payoutReady, same, short, type GroupDetail, type PayoutView } from '../../lib/group.ts'
import { deadline, groupNonce, relayOpen, signAndRelayGroup } from '../../lib/chainActions.ts'
import { parseUsdt } from '../../lib/amounts.ts'
import { makeError } from '../../lib/errors.ts'
import { Button, Card, ErrorPanel, usdt } from '../../components/ui.tsx'
import { Field } from '../save/NewPocket.tsx'
import type { Flow, Start } from './Group.tsx'

export const who = (a: string, me: string) => (same(a, me) ? 'you' : short(a))

export function payoutApproveFlow(evm: Address, g: GroupDetail, po: PayoutView): Flow {
  const { missing, iAmOfficer } = officerNeeded(po, g, evm)
  return {
    summary: {
      what: `Approve a social fund payment to ${who(po.recipient, evm)}`, amount: `${usdt(po.amount)} USDT`, chain: 'Polygon',
      extra: [
        ['Reason', po.reason],
        ['Your money', 'Not touched (it comes from the social fund)'],
        ...(missing && iAmOfficer ? [['Your role', g.treasurers.length ? 'Your approval is the Treasurer approval it needs' : 'As Admin, your approval stands in for a Treasurer'] as [string, string]] : []),
      ],
    },
    steps: [{ label: 'Approve the payment', chain: 'polygon', run: async () => signAndRelayGroup('group.approveSocialPayout', 'ApproveSocialPayout', evm, { member: evm, payoutId: po.id, nonce: await groupNonce(evm), deadline: deadline() }) }],
  }
}

export function payoutExecuteFlow(evm: Address, po: PayoutView): Flow {
  return {
    summary: { what: `Pay the approved social fund payment to ${who(po.recipient, evm)}`, amount: `${usdt(po.amount)} USDT`, chain: 'Polygon', extra: [['From', 'The social fund only'], ['Reason', po.reason]] },
    steps: [{ label: 'Pay it', chain: 'polygon', signs: false, run: () => relayOpen('group.executeSocialPayout', po.id) }],
  }
}

export function SocialFundCard({ evm, g, startNoMoney }: { evm: Address, g: GroupDetail, startNoMoney: Start }) {
  const [to, setTo] = useState<string>(evm)
  const [amt, setAmt] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const open = g.payouts.filter(po => !po.executed && !payoutExpired(po, g))
  const done = g.payouts.filter(po => po.executed)
  const expired = g.payouts.filter(po => payoutExpired(po, g))
  const cap = g.p.maxSocialPayout
  const officer = g.treasurers.length ? 'a Treasurer' : 'the Admin (the group has no Treasurer)'

  function propose() {
    setErr(null)
    const a = parseUsdt(amt)
    const r = reason.trim()
    if (!a) return setErr('Enter an amount like 2 or 0.50')
    if (a > g.socialFund) return setErr(`The social fund holds ${usdt(g.socialFund)} USDT.`)
    if (cap > 0n && a > cap) return setErr(`This group allows at most ${usdt(cap)} USDT per payment.`)
    if (!r) return setErr('Say what the payment is for.')
    if (byteLen(r) > 80) return setErr('Keep the reason under 80 characters.')
    const recipient = to as Address
    startNoMoney({
      summary: {
        what: `Propose a social fund payment to ${who(recipient, evm)}`, amount: `${usdt(a)} USDT`, chain: 'Polygon',
        extra: [['Reason', r], ['Paid when', `${g.p.approvalsRequired} other member${g.p.approvalsRequired === 1 ? '' : 's'} approve, including ${officer}`], ['Expires', 'In 7 days, or at Share-Out if sooner'], ['Repay', 'Not needed: it is a payment from the social fund']],
      },
      steps: [{ label: 'Send the proposal', chain: 'polygon', run: async () => signAndRelayGroup('group.proposeSocialPayout', 'ProposeSocialPayout', evm, { proposer: evm, groupId: g.id, recipient, amount: a, reason: r, nonce: await groupNonce(evm), deadline: deadline() }) }],
    })
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Social fund (for emergencies)</h2>
        <span className="tabular font-bold">{usdt(g.socialFund)} USDT</span>
      </div>
      <p className="text-sm text-muted">
        A social fund payment needs {g.p.approvalsRequired} approval{g.p.approvalsRequired === 1 ? '' : 's'} from members other than the proposer and the recipient, including {officer}.
        {cap > 0n ? ` Up to ${usdt(cap)} USDT per payment.` : ''} What is left is shared equally at Share-Out.
      </p>

      {open.map(po => {
        const ready = payoutReady(po, g)
        const { missing } = officerNeeded(po, g, evm)
        return (
          <div key={String(po.id)} className="rounded-2xl bg-canvas p-3 text-sm">
            <p className="font-semibold">{usdt(po.amount)} USDT to {who(po.recipient, evm)}</p>
            <p className="break-words text-muted">{po.reason}</p>
            <p className="text-muted">Proposed by {who(po.proposer, evm)} · {po.approvals} of {g.p.approvalsRequired} approved{missing ? `, still needs ${g.treasurers.length ? 'a Treasurer' : 'the Admin'}` : ''} · expires {new Date(Number(po.expiresAt) * 1000).toLocaleString()}</p>
            {ready && <div className="mt-2"><Button onClick={() => startNoMoney(payoutExecuteFlow(evm, po))}>Pay it now</Button></div>}
            {!ready && canApprovePayout(po, evm, g) && !g.shareOutStarted && <div className="mt-2"><Button variant="secondary" onClick={() => startNoMoney(payoutApproveFlow(evm, g, po))}>Approve</Button></div>}
            {!ready && po.approvedBy[evm.toLowerCase()] && <p className="mt-1 font-semibold text-good">You approved.</p>}
          </div>
        )
      })}
      {done.length > 0 && <p className="text-xs text-muted">Paid: {done.map(po => `${who(po.recipient, evm)} ${usdt(po.amount)}`).join(' · ')}</p>}
      {expired.length > 0 && <p className="text-xs text-muted">{expired.length} proposal{expired.length === 1 ? '' : 's'} expired without enough approvals.</p>}

      {!g.shareOutStarted && g.socialFund > 0n && (
        <div className="space-y-3 border-t border-line pt-3">
          <h3 className="font-semibold">Propose a social fund payment</h3>
          <Field label="To">
            <select className="input" value={to} onChange={e => setTo(e.target.value)}>
              {g.members.map(m => <option key={m.address} value={m.address}>{same(m.address, evm) ? 'Me' : short(m.address)}</option>)}
            </select>
          </Field>
          <Field label="Amount (USDT)"><input className="input" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} placeholder="1" /></Field>
          <Field label="What is it for?"><input className="input" value={reason} maxLength={80} onChange={e => setReason(e.target.value)} placeholder="Hospital bill" /></Field>
          {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
          <Button variant="secondary" onClick={propose}>Propose payment</Button>
        </div>
      )}
    </Card>
  )
}

export type { Flow }

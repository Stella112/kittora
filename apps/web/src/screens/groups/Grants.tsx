import { useState } from 'react'
import type { Address } from 'viem'
import { same, short, type GroupDetail } from '../../lib/group.ts'
import { deadline, groupNonce, signAndRelayGroup } from '../../lib/chainActions.ts'
import { parseUsdt } from '../../lib/amounts.ts'
import { makeError } from '../../lib/errors.ts'
import { Button, Card, ErrorPanel, usdt } from '../../components/ui.tsx'
import { Field } from '../save/NewPocket.tsx'
import type { Start } from './Group.tsx'

/** Social fund: members ask for a grant (emergency, funeral, school fees); it pays out once enough others approve. */
export function GrantsCard({ evm, g, startNoMoney }: { evm: Address, g: GroupDetail, startNoMoney: Start }) {
  const [amt, setAmt] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const open = g.grants.filter(x => !x.paid)
  const paid = g.grants.filter(x => x.paid)

  function request() {
    setErr(null)
    const a = parseUsdt(amt)
    if (!a) return setErr('Enter an amount like 2 or 0.50')
    if (a > g.socialFund) return setErr(`The social fund holds ${usdt(g.socialFund)} USDT.`)
    startNoMoney({
      summary: { what: 'Ask the group for help from the social fund', amount: `${usdt(a)} USDT`, chain: 'Polygon', extra: [['Paid when', `${g.p.approvalsRequired} other member${g.p.approvalsRequired === 1 ? '' : 's'} approve`], ['Repay', 'Not needed: it is a grant']] },
      steps: [{ label: 'Send the request', chain: 'polygon', run: async () => signAndRelayGroup('group.requestGrant', 'RequestGrant', evm, { member: evm, groupId: g.id, amount: a, nonce: await groupNonce(evm), deadline: deadline() }) }],
    })
  }

  function approve(id: bigint, member: Address, amount: bigint, last: boolean) {
    startNoMoney({
      summary: { what: `Approve ${short(member)}'s social fund request`, amount: `${usdt(amount)} USDT`, chain: 'Polygon', extra: [['Effect', last ? 'This is the last approval needed: it pays out now' : 'Counts toward the approvals needed'], ['Your money', 'Not touched (it comes from the social fund)']] },
      steps: [{ label: 'Approve the request', chain: 'polygon', run: async () => signAndRelayGroup('group.approveGrant', 'ApproveGrant', evm, { member: evm, grantId: id, nonce: await groupNonce(evm), deadline: deadline() }) }],
    })
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Social fund</h2>
        <span className="tabular font-bold">{usdt(g.socialFund)} USDT</span>
      </div>
      <p className="text-sm text-muted">For members in need. Requests need {g.p.approvalsRequired} approval{g.p.approvalsRequired === 1 ? '' : 's'} from others. What is left is shared equally at Share-Out.</p>
      {open.map(x => {
        const mine = same(x.member, evm)
        const approved = x.approvedBy[evm.toLowerCase()]
        return (
          <div key={String(x.id)} className="rounded-2xl bg-canvas p-3 text-sm">
            <p className="font-semibold">{mine ? 'Your request' : short(x.member)}: {usdt(x.amount)} USDT</p>
            <p className="text-muted">Approvals {x.approvals} of {g.p.approvalsRequired}</p>
            {!mine && !approved && !g.shareOutStarted && <div className="mt-2"><Button variant="secondary" onClick={() => approve(x.id, x.member, x.amount, x.approvals + 1 >= g.p.approvalsRequired)}>Approve</Button></div>}
            {!mine && approved && <p className="mt-1 font-semibold text-good">You approved.</p>}
          </div>
        )
      })}
      {paid.length > 0 && <p className="text-xs text-muted">Paid so far: {paid.map(x => `${same(x.member, evm) ? 'you' : short(x.member)} ${usdt(x.amount)}`).join(' · ')}</p>}
      {!g.shareOutStarted && g.socialFund > 0n && (
        <>
          <Field label="Ask for (USDT)"><input className="input" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} placeholder="1" /></Field>
          {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
          <Button variant="ghost" onClick={request}>Ask for help</Button>
        </>
      )}
    </Card>
  )
}

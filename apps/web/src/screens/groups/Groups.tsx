import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { Address } from 'viem'
import { usePortfolio } from '../../lib/portfolio.ts'
import { groupName, parseGroupRef } from '../../lib/group.ts'
import { classify, makeError } from '../../lib/errors.ts'
import { Button, Card, ErrorPanel, Spinner, usdt } from '../../components/ui.tsx'
import { RequireEvm } from '../../components/RequireEvm.tsx'
import { Field } from '../save/NewPocket.tsx'

export function Groups() {
  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-2xl font-bold">Group Kitty</h1>
      <p className="text-muted">Save together like an esusu or VSLA: buy shares at each meeting, borrow with guarantors, and share the interest at the end.</p>
      <RequireEvm>{evm => <GroupsBody evm={evm} />}</RequireEvm>
    </div>
  )
}

function GroupsBody({ evm }: { evm: Address }) {
  const nav = useNavigate()
  const q = usePortfolio(evm)
  const [ref, setRef] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const now = BigInt(Math.floor(Date.now() / 1000))

  function open() {
    const id = parseGroupRef(ref)
    if (!id) return setErr('Enter a group number like 3, or paste the invite link.')
    nav(`/groups/${id}`)
  }

  return (
    <>
      {q.isLoading && <Spinner label="Loading your groups…" />}
      {q.error && <ErrorPanel error={classify(q.error)} onRetry={() => q.refetch()} compact />}
      {q.data?.groups.length ? (
        <ul className="space-y-3">
          {q.data.groups.map(g => (
            <li key={String(g.id)}>
              <Link to={`/groups/${g.id}`} className="block">
                <Card className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold">{groupName(g.id)}</p>
                    <p className="text-sm text-muted">{g.shares.toString()} shares · {g.shareOutOpen ? 'Share-Out open' : `next meeting ${new Date(Number(g.nextMeetingAt < g.cycleEnd ? g.nextMeetingAt : g.cycleEnd) * 1000).toLocaleString()}`}</p>
                  </div>
                  <p className="tabular text-right text-lg font-bold">{usdt(g.value)}<span className="block text-xs font-normal text-muted">USDT</span></p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : q.data && (
        <Card><p className="text-muted">You are not in a group yet. Start one and invite your people, or join with an invite.</p></Card>
      )}
      {q.data && q.data.groups.some(g => g.cycleEnd <= now) && <p className="text-sm text-muted">Groups past their end date are ready for Share-Out.</p>}

      <Button onClick={() => nav('/groups/new')}>Start a group</Button>
      <Card className="space-y-3">
        <h2 className="font-bold">Join a group</h2>
        <Field label="Group number or invite link"><input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="3" /></Field>
        {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
        <Button variant="secondary" onClick={open}>Open group</Button>
      </Card>
    </>
  )
}

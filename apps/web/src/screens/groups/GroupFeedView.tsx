// A1.2 Activity tab for a group: filters, rows with initiator / approvers / status / links. Plain text only.
import { useState } from 'react'
import type { Address } from 'viem'
import { short, same } from '../../lib/group.ts'
import { applyFilter, type FeedFilter, type FeedRowV2, type FeedStatus } from '../../lib/groupFeed.ts'
import { polygonscanTx } from '../../lib/chainActions.ts'
import { Button, Card, Spinner, usdt } from '../../components/ui.tsx'

const FILTERS: [FeedFilter, string][] = [['all', 'All'], ['money', 'Money in'], ['loans', 'Loans'], ['approvals', 'Approvals']]

const STATUS_STYLE: Record<FeedStatus, string> = {
  'Pending approval': 'bg-warn-soft text-warn',
  Approved: 'bg-brand-soft text-brand-strong',
  Submitted: 'bg-warn-soft text-warn',
  Confirmed: 'bg-good-soft text-good',
  Failed: 'bg-bad-soft text-bad',
  Expired: 'bg-canvas text-muted',
  Skipped: 'bg-canvas text-muted',
}

/** Replaces raw addresses in event text with "you" or a short address. */
export const humanize = (text: string, me: string) => text.replace(/0x[0-9a-fA-F]{40}/g, a => (same(a, me) ? 'you' : short(a)))

const initiator = (actor: string | null, me: string) =>
  actor === 'autosave' ? 'Autosave' : actor === null ? 'Kittora relay' : same(actor, me) ? 'You' : short(actor)

export function GroupFeedView({ rows, evm, loading, onStart }: { rows: FeedRowV2[], evm: Address, loading: boolean, onStart: () => void }) {
  const [filter, setFilter] = useState<FeedFilter>('all')
  const shown = applyFilter(rows, filter)
  if (loading) return <Spinner label="Reading the group's activity…" />
  if (rows.length === 0) {
    return (
      <Card className="space-y-3">
        <p className="text-muted">No activity yet: buy your first shares to start the cycle</p>
        <Button onClick={onStart}>Buy shares</Button>
      </Card>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filter activity">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold ${filter === f ? 'bg-brand text-white' : 'bg-brand-soft text-brand-strong'}`}>{label}</button>
        ))}
      </div>
      {shown.length === 0 && <Card><p className="text-sm text-muted">Nothing here yet.</p></Card>}
      <ul className="space-y-2">
        {shown.map(r => (
          <li key={r.key}>
            <Card className="space-y-1 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold">{humanize(r.title, evm)}</p>
                  {r.detail && <p className="break-words text-sm text-muted">{humanize(r.detail, evm)}</p>}
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[r.status]}`}>{r.status}</span>
              </div>
              {r.approvals && (
                <p className="text-sm">
                  <b>{r.approvals.have} of {r.approvals.need} approved</b>
                  {r.approvals.who.length > 0 && <span className="text-muted">: {r.approvals.who.map(a => (same(a, evm) ? 'you' : short(a))).join(', ')}</span>}
                  {r.approvals.note && <span className="text-muted"> · {r.approvals.note}</span>}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted">
                <span>
                  {initiator(r.actor, evm)}
                  {r.amount !== null && <> · <b className="tabular text-ink">{usdt(r.amount)} USDT</b></>}
                  {r.ts ? ` · ${new Date(r.ts * 1000).toLocaleString()}` : ''}
                </span>
                {r.hash && <a className="font-semibold text-brand-strong underline" href={polygonscanTx(r.hash)} target="_blank" rel="noreferrer">Polygonscan</a>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}

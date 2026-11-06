import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { relayer } from '../lib/relayer.ts'
import { readActivity } from '../lib/activity.ts'
import { buildFeed, type FeedRow } from '../lib/activityFeed.ts'
import { nimiqTx, polygonscanTx } from '../lib/chainActions.ts'
import { hostNetwork } from '../lib/nimiq.ts'
import { classify } from '../lib/errors.ts'
import { Card, ErrorPanel, Spinner } from '../components/ui.tsx'
import { RequireEvm } from '../components/RequireEvm.tsx'

export function Activity() {
  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-2xl font-bold">Activity</h1>
      <RequireEvm>{evm => <ActivityBody evm={evm} />}</RequireEvm>
    </div>
  )
}

const STAMP: Record<FeedRow['status'], [string, string]> = {
  confirmed: ['Confirmed', 'bg-good-soft text-good'],
  pending: ['Pending', 'bg-warn-soft text-warn'],
  failed: ['Failed', 'bg-bad-soft text-bad'],
}

function ActivityBody({ evm }: { evm: Address }) {
  const q = useQuery({ queryKey: ['activity', evm], queryFn: () => relayer.activity(evm), refetchInterval: 20_000, retry: 1 })
  const local = readActivity(evm)
  // Local items still show if the index is unreachable, so a pending transaction never disappears.
  const rows = buildFeed(q.data?.items ?? [], local, evm)
  const testnet = hostNetwork() === 'testnet'

  return (
    <>
      {q.isLoading && <Spinner label="Reading your activity…" />}
      {q.error && <ErrorPanel error={classify(q.error)} onRetry={() => q.refetch()} compact />}
      {!q.isLoading && rows.length === 0 && <Card><p className="text-muted">Nothing yet. Your deposits, group shares, loans and Share-Outs will appear here, each with its explorer link.</p></Card>}
      <ul className="space-y-2">
        {rows.map(r => (
          <li key={r.hash}>
            <Card className="space-y-1 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className={`space-y-0.5 text-[15px] ${r.tone === 'bad' ? 'text-bad' : ''}`}>
                  {r.labels.map(l => <p key={l} className="font-semibold">{l}</p>)}
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${STAMP[r.status][1]}`}>{STAMP[r.status][0]}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm text-muted">
                <span>{r.ts ? new Date(r.ts * 1000).toLocaleString() : 'just now'} · {r.chain === 'nimiq' ? 'Nimiq' : 'Polygon'}</span>
                <a className="font-semibold text-brand-strong underline" href={r.chain === 'nimiq' ? nimiqTx(r.hash, testnet) : polygonscanTx(r.hash)} target="_blank" rel="noreferrer">
                  {r.chain === 'nimiq' ? 'Nimiq explorer' : 'Polygonscan'}
                </a>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  )
}

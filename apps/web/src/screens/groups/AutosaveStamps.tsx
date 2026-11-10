// Autosave runs are sent by the relayer while the member is away, so nobody stamps them at the time. When the member
// opens the group, offer to stamp their unstamped runs on Nimiq (1 Luna to themselves each, one approval per run).
// The relayer verifies each stamp exactly like any other: status changes only after verification.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import { same } from '../../lib/group.ts'
import type { GroupFeedRow } from '../../lib/relayer.ts'
import { stampGroupAction } from '../../lib/stamp.ts'
import { classify } from '../../lib/errors.ts'
import { Button, Card, Spinner } from '../../components/ui.tsx'

export const unstampedRuns = (feed: GroupFeedRow[], me: string) =>
  feed.filter(i => i.event === 'SharesBought' && i.actor === 'autosave' && same(String(i.args.member), me) && !(i as { stamp?: string }).stamp)

export function AutosaveStamps({ feed, evm, groupId }: { feed: GroupFeedRow[], evm: Address, groupId: bigint }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const runs = unstampedRuns(feed, evm)
  if (runs.length === 0 && !msg) return null

  async function stampAll() {
    setMsg(null)
    let done = 0
    for (const r of runs) {
      setBusy(`Stamping run ${done + 1} of ${runs.length}…`)
      try {
        await stampGroupAction('mandate.run', r.hash as Hex, groupId)
        done++
      } catch (e) {
        const err = classify(e)
        setMsg(err.kind === 'rejected' ? `Stopped. ${done} stamped; you can stamp the rest later.` : `${done} stamped. The next one did not go through (${err.title.toLowerCase()}); try again later.`)
        break
      }
    }
    if (done === runs.length) setMsg(`${done} Autosave run${done === 1 ? '' : 's'} stamped on Nimiq.`)
    setBusy(null)
    await qc.invalidateQueries({ queryKey: ['groupFeed'] })
  }

  return (
    <Card className="space-y-2">
      <h2 className="font-bold">Stamp your Autosave runs</h2>
      {runs.length > 0 && <p className="text-sm text-muted">{runs.length} Autosave purchase{runs.length === 1 ? ' happened' : 's happened'} while you were away. Stamp a public receipt on Nimiq for each (1 Luna to yourself, one approval each). Optional.</p>}
      {busy ? <Spinner label={busy} /> : runs.length > 0 && <Button variant="secondary" onClick={stampAll}>Stamp {runs.length === 1 ? 'it' : `all ${runs.length}`}</Button>}
      {msg && <p className="text-sm font-semibold">{msg}</p>}
    </Card>
  )
}

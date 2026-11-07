import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { decodeEventLog, type Abi, type Address, type Hex } from 'viem'
import { GroupKittyAbi } from '@kittora/core'
import { parseUsdt } from '../../lib/amounts.ts'
import { deadline, groupNonce, signAndRelayGroup } from '../../lib/chainActions.ts'
import { reader } from '../../lib/evm.ts'
import { COVERS } from '../../lib/covers.ts'
import { CoverPicker, profileError } from './AdminPanel.tsx'
import { makeError } from '../../lib/errors.ts'
import { Button, Card, ErrorPanel, usdt } from '../../components/ui.tsx'
import { RequireEvm } from '../../components/RequireEvm.tsx'
import { TxFlow, type TxStep } from '../../components/TxFlow.tsx'
import { Field } from '../save/NewPocket.tsx'

export const MEETING_INTERVALS = [['Every hour (pilot)', 3600], ['Every week', 604800], ['Every 2 weeks', 1209600], ['Every 30 days', 2592000]] as const
const GRACE = [['1 hour', 3600], ['1 day', 86400], ['3 days', 259200], ['7 days', 604800]] as const
export const intervalLabel = (s: bigint) => MEETING_INTERVALS.find(i => BigInt(i[1]) === s)?.[0] ?? `Every ${Number(s) / 3600} h`
export const durationLabel = (s: bigint) => {
  const n = Number(s)
  return n % 86400 === 0 ? `${n / 86400} day${n === 86400 ? '' : 's'}` : n % 3600 === 0 ? `${n / 3600} hour${n === 3600 ? '' : 's'}` : `${Math.round(n / 60)} min`
}

export function NewGroup() {
  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-2xl font-bold">Start a group</h1>
      <p className="text-muted">You set the rules once. They are written into the contract and cannot be changed later, by you or by Kittora.</p>
      <RequireEvm>{evm => <Form evm={evm} />}</RequireEvm>
    </div>
  )
}

interface Draft {
  sharePrice: bigint; socialFundPerMeeting: bigint; meetingInterval: bigint; cycleEnd: bigint; gracePeriod: bigint
  interestBps: number; maxLoanMultipleBps: number; maxSharesPerMeeting: number; approvalsRequired: number; maxMembers: number
  maxSocialPayout: bigint; name: string; purpose: string; coverId: number
}

function Form({ evm }: { evm: Address }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [coverId, setCoverId] = useState(0)
  const [payoutCap, setPayoutCap] = useState('5')
  const [price, setPrice] = useState('1')
  const [social, setSocial] = useState('0.20')
  const [interval, setIntervalS] = useState(604800)
  const [meetings, setMeetings] = useState('12')
  const [maxShares, setMaxShares] = useState(5)
  const [interest, setInterest] = useState('10')
  const [multiple, setMultiple] = useState(30000)
  const [grace, setGrace] = useState(259200)
  const [approvals, setApprovals] = useState('2')
  const [maxMembers, setMaxMembers] = useState('10')
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const hashRef = useRef<Hex | null>(null)

  async function review() {
    setErr(null)
    const pe = profileError(name, purpose)
    if (pe) return setErr(pe)
    const cap = payoutCap.trim() === '' || Number(payoutCap) === 0 ? 0n : parseUsdt(payoutCap)
    if (cap === null) return setErr('Enter the largest social fund payment, or 0 for no cap.')
    const sp = parseUsdt(price)
    if (!sp) return setErr('Enter a share price like 1 or 0.50.')
    if (sp > 25_000_000n) return setErr('Pilot limit: a share costs at most 25 USDT.')
    const sf = social.trim() === '' || Number(social) === 0 ? 0n : parseUsdt(social)
    if (sf === null) return setErr('Enter the social fund per meeting, or 0.')
    const n = Number(meetings)
    if (!Number.isInteger(n) || n < 1 || n > 104) return setErr('Choose 1 to 104 meetings.')
    const ir = Number(interest)
    if (!Number.isFinite(ir) || ir < 0 || ir > 100 || Math.round(ir * 100) !== ir * 100) return setErr('Interest is 0 to 100%, up to 2 decimals.')
    const mm = Number(maxMembers)
    if (!Number.isInteger(mm) || mm < 2 || mm > 30) return setErr('A group has 2 to 30 members in the pilot.')
    const ap = Number(approvals)
    if (!Number.isInteger(ap) || ap < 1 || ap >= mm) return setErr(`Approvals needed: 1 to ${mm - 1} (fewer than the member limit).`)
    // the contract's clock: cycleEnd is compared with block.timestamp
    const now = await reader().getBlock({ blockTag: 'latest' }).then(b => b.timestamp).catch(() => BigInt(Math.floor(Date.now() / 1000)))
    setDraft({
      sharePrice: sp, socialFundPerMeeting: sf, meetingInterval: BigInt(interval), cycleEnd: now + BigInt(interval) * BigInt(n) + 60n,
      gracePeriod: BigInt(grace), interestBps: Math.round(ir * 100), maxLoanMultipleBps: multiple, maxSharesPerMeeting: maxShares, approvalsRequired: ap, maxMembers: mm,
      maxSocialPayout: cap, name: name.trim(), purpose: purpose.trim(), coverId,
    })
  }

  async function finish() {
    let id: bigint | null = null
    try {
      const rc = await reader().getTransactionReceipt({ hash: hashRef.current! })
      for (const l of rc.logs) {
        try {
          const ev = decodeEventLog({ abi: GroupKittyAbi as Abi, data: l.data, topics: l.topics }) as unknown as { eventName: string, args: { groupId: bigint } }
          if (ev.eventName === 'GroupCreated') id = ev.args.groupId
        } catch { /* other events */ }
      }
    } catch { /* fall back to the list */ }
    await qc.invalidateQueries({ queryKey: ['portfolio'] })
    nav(id !== null ? `/groups/${id}?invite=1` : '/groups')
  }

  if (draft) {
    const steps: TxStep[] = [{
      label: 'Create the group', chain: 'polygon',
      run: async () => {
        hashRef.current = await signAndRelayGroup('group.createGroup', 'CreateGroup', evm, { creator: evm, ...draft, nonce: await groupNonce(evm), deadline: deadline() })
        return hashRef.current
      },
    }]
    return (
      <TxFlow
        owner={evm}
        summary={{
          what: `Create ${draft.name} (you join as the first member, as Admin)`,
          chain: 'Polygon',
          extra: [
            ['Share price', `${usdt(draft.sharePrice)} USDT`],
            ['Social fund', `${usdt(draft.socialFundPerMeeting)} USDT per meeting`],
            ['Meetings', `${intervalLabel(draft.meetingInterval)}, ${meetings} in total`],
            ['Share-Out', new Date(Number(draft.cycleEnd) * 1000).toLocaleString()],
            ['Loans', `${draft.interestBps / 100}% interest, up to ${draft.maxLoanMultipleBps / 10000}× own savings, ${draft.approvalsRequired} approval${draft.approvalsRequired === 1 ? '' : 's'}`],
            ['Grace period', durationLabel(draft.gracePeriod)],
            ['Members', `up to ${draft.maxMembers}`],
            ['Social fund payments', draft.maxSocialPayout > 0n ? `up to ${usdt(draft.maxSocialPayout)} USDT each` : 'no cap beyond the fund'],
            ['Profile', `${draft.purpose || 'no purpose'} · ${COVERS[draft.coverId].name} cover`],
            ['Pilot limit', '500 USDT per group pool'],
          ],
        }}
        steps={steps}
        onDone={finish}
        onCancel={() => setDraft(null)}
        doneText="Open the group"
      />
    )
  }

  return (
    <Card className="space-y-4">
      <Field label="Group name"><input className="input" value={name} maxLength={32} onChange={e => setName(e.target.value)} placeholder="Market women's kitty" /></Field>
      <Field label="Purpose (optional)"><input className="input" value={purpose} maxLength={80} onChange={e => setPurpose(e.target.value)} placeholder="Market traders, Yaba" /></Field>
      <div>
        <span className="mb-1 block text-sm font-semibold">Cover</span>
        <CoverPicker value={coverId} onChange={setCoverId} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Share price (USDT)"><input className="input" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></Field>
        <Field label="Social fund / meeting"><input className="input" inputMode="decimal" value={social} onChange={e => setSocial(e.target.value)} /></Field>
      </div>
      <Field label="Meetings">
        <select className="input" value={interval} onChange={e => { const v = Number(e.target.value); setIntervalS(v); if (v === 3600) setGrace(3600) }}>
          {MEETING_INTERVALS.map(([l, s]) => <option key={s} value={s}>{l}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Number of meetings"><input className="input" inputMode="numeric" value={meetings} onChange={e => setMeetings(e.target.value)} /></Field>
        <Field label="Max shares / meeting">
          <select className="input" value={maxShares} onChange={e => setMaxShares(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Loan interest (%)"><input className="input" inputMode="decimal" value={interest} onChange={e => setInterest(e.target.value)} /></Field>
        <Field label="Loan limit">
          <select className="input" value={multiple} onChange={e => setMultiple(Number(e.target.value))}>{[[10000, '1× savings'], [20000, '2× savings'], [30000, '3× savings']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Approvals per loan"><input className="input" inputMode="numeric" value={approvals} onChange={e => setApprovals(e.target.value)} /></Field>
        <Field label="Max members"><input className="input" inputMode="numeric" value={maxMembers} onChange={e => setMaxMembers(e.target.value)} /></Field>
      </div>
      <Field label="Largest social fund payment (USDT, 0 = no cap)"><input className="input" inputMode="decimal" value={payoutCap} onChange={e => setPayoutCap(e.target.value)} /></Field>
      <Field label="Grace period before a late loan defaults">
        <select className="input" value={grace} onChange={e => setGrace(Number(e.target.value))}>{GRACE.map(([l, s]) => <option key={s} value={s}>{l}</option>)}</select>
      </Field>
      <p className="text-sm text-muted">Interest is a flat percentage of each loan and stays in the pool, so it is shared by everyone at Share-Out.</p>
      {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
      <Button onClick={review}>Review</Button>
    </Card>
  )
}

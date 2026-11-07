import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useGroup, useGroupFeed, Role, same, short, type GroupDetail } from '../../lib/group.ts'
import { buildGroupFeed } from '../../lib/groupFeed.ts'
import { cover, coverStyle } from '../../lib/covers.ts'
import { usePortfolio, type Portfolio } from '../../lib/portfolio.ts'
import { deadline, groupNonce, signAndRelayGroup, signAndRelayVault, usdtBalance, vaultNonce, GROUP } from '../../lib/chainActions.ts'
import { approveStep, revokeMandateSteps } from '../../lib/steps.ts'
import { classify, makeError } from '../../lib/errors.ts'
import { config, openInNimiqPayLinks } from '../../config.ts'
import { Button, Card, ErrorPanel, Spinner, usdt } from '../../components/ui.tsx'
import { RequireEvm } from '../../components/RequireEvm.tsx'
import { TxFlow, type Summary, type TxStep } from '../../components/TxFlow.tsx'
import { Field } from '../save/NewPocket.tsx'
import { pocketName } from '../save/Save.tsx'
import { disclosureAccepted } from '../Disclosure.tsx'
import { countdown, useNow } from '../Home.tsx'
import { durationLabel, intervalLabel } from './NewGroup.tsx'
import { LoansSection } from './Loans.tsx'
import { SocialFundCard } from './SocialFund.tsx'
import { MembersTab, RolePill } from './Members.tsx'
import { GroupFeedView } from './GroupFeedView.tsx'
import { Pinned } from './Pinned.tsx'
import { AdminPanel } from './AdminPanel.tsx'

export type Flow = { summary: Summary, steps: TxStep[] } | null
export type Start = (f: Flow) => void
const POOL_CAP = 500_000_000n
/** On-chain profile name (A1.1); plain text, rendered by React (never as HTML). */
export const gname = (g: Pick<GroupDetail, 'profile' | 'id'>) => g.profile.name || `Group #${g.id}`
type Tab = 'group' | 'members' | 'activity' | 'admin'

export function Group() {
  return <div className="space-y-4 pt-2"><RequireEvm>{evm => <GroupBody evm={evm} />}</RequireEvm></div>
}

function GroupBody({ evm }: { evm: Address }) {
  const params = useParams()
  const [search] = useSearchParams()
  const nav = useNavigate()
  const id = /^\d{1,12}$/.test(params.id ?? '') ? BigInt(params.id!) : null
  const q = useGroup(id, evm)
  const pf = usePortfolio(evm)
  const qc = useQueryClient()
  const [flow, setFlow] = useState<Flow>(null)
  const [tab, setTab] = useState<Tab>('group')
  const feedQ = useGroupFeed(id)

  const done = async () => {
    setFlow(null)
    await Promise.all([qc.invalidateQueries({ queryKey: ['group'] }), qc.invalidateQueries({ queryKey: ['groupFeed'] }), qc.invalidateQueries({ queryKey: ['portfolio'] })])
  }
  // Money actions need the disclosure first (brief §4.1 item 7); joining and approving do not move the signer's money.
  const start: Start = f => (disclosureAccepted() ? setFlow(f) : nav(`/disclosure?next=/groups/${id}`))

  if (id === null) return <ErrorPanel error={makeError('blocked', undefined, 'That is not a group number.')} />
  if (q.isLoading) return <Spinner label="Reading the group…" />
  if (q.error) return <ErrorPanel error={classify(q.error)} onRetry={() => q.refetch()} />
  const g = q.data
  if (!g) return <ErrorPanel error={makeError('blocked', undefined, `Group #${id} does not exist yet. Check the number or the invite link.`)} />
  if (flow) return <TxFlow owner={evm} summary={flow.summary} steps={flow.steps} onDone={done} onCancel={() => setFlow(null)} stampGroup={g.id} />

  const back = <Link to="/groups" className="text-sm font-semibold text-brand-strong">← Groups</Link>
  if (!g.me) return <>{back}<JoinCard evm={evm} g={g} start={setFlow} /></>

  const ended = g.now >= g.p.cycleEnd
  const feed = feedQ.data?.items ?? []
  const rows = buildGroupFeed(feed, g, g.approvers)
  const isAdmin = g.me.role === Role.Admin
  const tabs: [Tab, string][] = [['group', 'Group'], ['members', 'Members'], ['activity', 'Activity'], ...(isAdmin ? [['admin', 'Admin'] as [Tab, string]] : [])]
  return (
    <>
      {back}
      <Header g={g} evm={evm} />
      <MissedNotice g={g} evm={evm} />
      <Pinned g={g} evm={evm} start={start} startNoMoney={setFlow} />
      <nav className="grid gap-1 rounded-2xl bg-brand-soft p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} aria-label="Group sections">
        {tabs.map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t}
            className={`min-h-10 rounded-xl text-sm font-semibold ${tab === t ? 'bg-surface text-ink shadow-sm' : 'text-brand-strong'}`}>{label}</button>
        ))}
      </nav>
      {tab === 'group' && (
        <>
          <InviteCard g={g} open={search.get('invite') === '1'} />
          {ended && <ShareOutCard evm={evm} g={g} pf={pf.data} start={start} />}
          {!ended && <BuyCard evm={evm} g={g} start={start} />}
          <Board g={g} evm={evm} />
          <LoansSection evm={evm} g={g} start={start} startNoMoney={setFlow} />
          <SocialFundCard evm={evm} g={g} startNoMoney={setFlow} />
          {!ended && <GroupAutosave evm={evm} g={g} pf={pf.data} start={start} />}
          <Rules g={g} />
        </>
      )}
      {tab === 'members' && <MembersTab g={g} evm={evm} feed={feed} />}
      {tab === 'activity' && <GroupFeedView rows={rows} evm={evm} loading={feedQ.isLoading} onStart={() => setTab('group')} />}
      {tab === 'admin' && isAdmin && <AdminPanel g={g} evm={evm} startNoMoney={setFlow} />}
    </>
  )
}

/** A1.3: tell me when my Autosave missed this or the previous meeting. */
function MissedNotice({ g, evm }: { g: GroupDetail, evm: Address }) {
  const miss = g.autosaveWindows.find(w => w.status === 'failed' && same(w.member, evm) && w.windowIdx >= Number(g.meeting) - 1)
  if (!miss) return null
  return (
    <div role="alert" className="rounded-2xl bg-bad-soft p-4 text-sm">
      <p className="font-semibold text-bad">Missed contribution: meeting {miss.windowIdx + 1}</p>
      <p className="mt-1 text-ink">{miss.reason ?? 'Your Autosave could not buy your shares.'} Buy by hand below, or fix it before the next meeting.</p>
    </div>
  )
}

function Header({ g, evm }: { g: GroupDetail, evm: Address }) {
  const now = useNow() + g.skew
  const ended = BigInt(now) >= g.p.cycleEnd
  const me = g.me!
  const myValue = g.totalShares === 0n ? me.shares * g.p.sharePrice : (me.shares * (g.cash + g.outstanding)) / g.totalShares
  return (
    <Card className="!bg-none" >
      <div className="-m-5 rounded-3xl p-5" style={coverStyle(g.profile.coverId)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-lg font-extrabold leading-tight">{gname(g)}<RolePill role={g.me!.role} /></p>
          {g.profile.purpose && <p className="break-words text-sm" style={{ color: cover(g.profile.coverId).sub }}>{g.profile.purpose}</p>}
          {same(g.creator, evm) && <p className="text-xs" style={{ color: cover(g.profile.coverId).sub }}>You started it</p>}
          <p className="tabular mt-1 text-4xl font-extrabold">{usdt(myValue)} <span className="text-lg">USDT</span></p>
          <p className="text-sm opacity-90">your {me.shares.toString()} share{me.shares === 1n ? '' : 's'}{me.pledged > 0n ? ` (${me.pledged} pledged as guarantor)` : ''}</p>
        </div>
        <div className="text-right">
          <p className="text-sm opacity-90">{ended ? 'Share-Out' : `Meeting ${Number(g.meeting) + 1} of ${g.totalMeetings}`}</p>
          <p className="tabular text-xl font-bold">{ended ? 'open' : countdown(g.nextMeetingAt < g.p.cycleEnd ? g.nextMeetingAt : g.p.cycleEnd, now)}</p>
          {!ended && <p className="text-xs opacity-90">{g.nextMeetingAt < g.p.cycleEnd ? 'until next meeting' : 'until Share-Out'}</p>}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div><dt className="opacity-90">Pool</dt><dd className="tabular font-bold">{usdt(g.cash + g.outstanding)}</dd></div>
        <div><dt className="opacity-90">Social fund</dt><dd className="tabular font-bold">{usdt(g.socialFund)}</dd></div>
        <div><dt className="opacity-90">Members</dt><dd className="tabular font-bold">{g.memberCount}/{g.p.maxMembers}</dd></div>
      </dl>
      <p className="mt-2 text-xs opacity-90">1 share is worth {usdt(g.shareValue)} USDT now (paid {usdt(g.p.sharePrice)}). Interest repaid on loans raises it for everyone.</p>
      </div>
    </Card>
  )
}

function inviteUrl(g: GroupDetail) {
  return openInNimiqPayLinks(new URL(`/groups/${g.id}`, config.publicUrl).toString()).universal
}

function InviteCard({ g, open }: { g: GroupDetail, open: boolean }) {
  const [copied, setCopied] = useState(false)
  const [show, setShow] = useState(open)
  const full = g.memberCount >= g.p.maxMembers
  if (full) return null
  const url = inviteUrl(g)
  async function share() {
    const text = `Join ${gname(g)} on Kittora (group #${g.id})`
    try {
      if (navigator.share) { await navigator.share({ title: 'Kittora', text, url }); return }
    } catch { /* fall back to copy */ }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { setShow(true) }
  }
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">Invite members</h2>
        <span className="text-sm text-muted">group #{g.id.toString()}</span>
      </div>
      {open && <p className="text-sm font-semibold text-good">Your group is live. Send this link to your members.</p>}
      <p className="text-sm text-muted">They open it in Nimiq Pay and join with one approval. Or they enter group number {g.id.toString()} in Groups.</p>
      {show && <p className="break-all rounded-2xl bg-canvas p-3 text-sm">{url}</p>}
      <Button variant="secondary" onClick={share}>{copied ? 'Link copied' : 'Share invite link'}</Button>
    </Card>
  )
}

function JoinCard({ evm, g, start }: { evm: Address, g: GroupDetail, start: Start }) {
  const blocked = g.now >= g.p.cycleEnd ? 'This group cycle has ended, so it cannot take new members.'
    : g.memberCount >= g.p.maxMembers ? 'This group is full.' : null
  function join() {
    start({
      summary: { what: `Join ${gname(g)}`, chain: 'Polygon', extra: [['Costs', 'Nothing now. You buy shares at meetings.']] },
      steps: [{ label: 'Join the group', chain: 'polygon', run: async () => signAndRelayGroup('group.join', 'JoinGroup', evm, { member: evm, groupId: g.id, nonce: await groupNonce(evm), deadline: deadline() }) }],
    })
  }
  return (
    <>
      <Card className="space-y-2" >
        <div className="-m-5 mb-0 rounded-3xl p-5" style={coverStyle(g.profile.coverId)}>
          <p className="text-sm" style={{ color: cover(g.profile.coverId).sub }}>You are invited to</p>
          <h1 className="break-words text-2xl font-bold">{gname(g)}</h1>
          {g.profile.purpose && <p className="break-words text-sm" style={{ color: cover(g.profile.coverId).sub }}>{g.profile.purpose}</p>}
        </div>
        <p className="text-sm text-muted">Group #{g.id.toString()} · {g.memberCount} of {g.p.maxMembers} members · started by {short(g.creator)}</p>
      </Card>
      <Rules g={g} />
      {blocked ? <ErrorPanel error={makeError('blocked', undefined, blocked)} /> : <Button onClick={join}>Join this group</Button>}
    </>
  )
}

function Rules({ g }: { g: GroupDetail }) {
  const rows: [string, string][] = [
    ['Share price', `${usdt(g.p.sharePrice)} USDT, up to ${g.p.maxSharesPerMeeting} per meeting`],
    ['Social fund', `${usdt(g.p.socialFundPerMeeting)} USDT per meeting (with your first share each meeting)`],
    ['Meetings', `${intervalLabel(g.p.meetingInterval)}, ${g.totalMeetings} in total`],
    ['Share-Out', new Date(Number(g.p.cycleEnd) * 1000).toLocaleString()],
    ['Loans', `${g.p.interestBps / 100}% flat interest, up to ${g.p.maxLoanMultipleBps / 10000}× your savings`],
    ['Approvals', `${g.p.approvalsRequired} member${g.p.approvalsRequired === 1 ? '' : 's'} per loan or social fund request, plus every guarantor`],
    ['Late loans', `Default after the due date + ${durationLabel(g.p.gracePeriod)}: the unpaid part comes from the borrower's shares first, then the guarantors' pledged shares. Others are never touched.`],
  ]
  return (
    <Card>
      <h2 className="font-bold">Group rules</h2>
      <p className="text-xs text-muted">Fixed in the contract when the group was created.</p>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map(([k, v]) => <div key={k}><dt className="font-semibold">{k}</dt><dd className="text-muted">{v}</dd></div>)}
      </dl>
    </Card>
  )
}

function BuyCard({ evm, g, start }: { evm: Address, g: GroupDetail, start: Start }) {
  const me = g.me!
  const boughtNow = me.history[me.history.length - 1] ?? 0n
  const left = g.p.maxSharesPerMeeting - Number(boughtNow)
  const [n, setN] = useState(1)
  const [err, setErr] = useState<string | null>(null)
  const social = me.socialPaidNow ? 0n : g.p.socialFundPerMeeting
  const cost = BigInt(n) * g.p.sharePrice + social

  async function go() {
    setErr(null)
    if (g.cash + g.outstanding + g.socialFund + cost > POOL_CAP) return setErr('This would take the group above its 500 USDT pilot limit.')
    const bal = await usdtBalance(evm).catch(() => null)
    if (bal !== null && bal < cost) return setErr(`This costs ${usdt(cost)} USDT and you have ${usdt(bal)} USDT on Polygon.`)
    start({
      summary: {
        what: `Buy ${n} share${n === 1 ? '' : 's'} in ${gname(g)}`, amount: `${usdt(cost)} USDT`, chain: 'Polygon',
        extra: [['Shares', `${n} × ${usdt(g.p.sharePrice)} USDT`], ...(social > 0n ? [['Social fund', `${usdt(social)} USDT (once per meeting)`] as [string, string]] : []), ['Meeting', `${Number(g.meeting) + 1} of ${g.totalMeetings}`]],
      },
      steps: [
        approveStep(evm, cost, GROUP),
        { label: `Buy ${n} share${n === 1 ? '' : 's'}`, chain: 'polygon', run: async () => signAndRelayGroup('group.buyShares', 'BuyShares', evm, { member: evm, groupId: g.id, shares: BigInt(n), nonce: await groupNonce(evm), deadline: deadline() }) },
      ],
    })
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Save at this meeting</h2>
      {left <= 0
        ? <p className="text-sm text-good font-semibold">You bought the most shares allowed this meeting ({boughtNow.toString()}). See you at the next one.</p>
        : (
          <>
            <p className="text-sm text-muted">{boughtNow > 0n ? `You bought ${boughtNow} this meeting. ` : ''}You can buy up to {left} more.</p>
            <div className="flex gap-2" role="group" aria-label="Shares to buy">
              {Array.from({ length: left }, (_, i) => i + 1).map(k => (
                <button key={k} type="button" onClick={() => setN(k)} aria-pressed={n === k}
                  className={`min-h-12 flex-1 rounded-2xl text-base font-bold ${n === k ? 'bg-brand text-white' : 'bg-brand-soft text-brand-strong'}`}>{k}</button>
              ))}
            </div>
            <p className="tabular text-sm">Total: <b>{usdt(cost)} USDT</b>{social > 0n ? ` (incl. ${usdt(social)} social fund)` : ''}</p>
            {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
            <Button onClick={go}>Buy {n} share{n === 1 ? '' : 's'}</Button>
          </>
        )}
    </Card>
  )
}

function Board({ g, evm }: { g: GroupDetail, evm: Address }) {
  const first = Number(g.meeting) - (g.me!.history.length - 1)
  const loanBy = new Map(g.loans.filter(l => l.status === 1 || l.status === 2).map(l => [l.borrower.toLowerCase(), l]))
  return (
    <Card>
      <h2 className="font-bold">Group board</h2>
      <p className="text-xs text-muted">Shares bought per meeting. A dash means none bought that meeting.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 pr-2 font-medium">Member</th>
              {g.me!.history.map((_, i) => <th key={i} className="px-1 py-1 text-center font-medium">M{first + i + 1}</th>)}
              <th className="py-1 pl-2 text-right font-medium">Shares</th>
            </tr>
          </thead>
          <tbody>
            {g.members.map(m => {
              const loan = loanBy.get(m.address.toLowerCase())
              return (
                <tr key={m.address} className="border-t border-line">
                  <td className="py-2 pr-2">
                    <span className="font-semibold">{same(m.address, evm) ? 'You' : short(m.address)}</span>
                    {same(m.address, g.creator) && <span className="ml-1 text-xs text-muted">starter</span>}
                    {loan && <span className="ml-1 rounded-full bg-warn-soft px-1.5 py-0.5 text-xs text-warn">{loan.status === 1 ? 'asking loan' : 'has loan'}</span>}
                  </td>
                  {m.history.map((s, i) => {
                    const current = i === m.history.length - 1
                    return (
                      <td key={i} className="px-1 py-2 text-center tabular">
                        {s > 0n ? <span className="font-bold text-good">{s.toString()}</span> : current ? <span className="text-muted">·</span> : <span className="text-bad" title="missed">–</span>}
                      </td>
                    )
                  })}
                  <td className="py-2 pl-2 text-right tabular font-semibold">{m.shares.toString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function GroupAutosave({ evm, g, pf, start }: { evm: Address, g: GroupDetail, pf: Portfolio | undefined, start: Start }) {
  const [n, setN] = useState(1)
  const [err, setErr] = useState<string | null>(null)
  const now = g.now
  const mandates = (pf?.mandates ?? []).filter(m => m.toGroup && m.destId === g.id)
  const active = mandates.filter(m => !m.revoked && m.runs < m.maxRuns && m.expiry >= now)
  const perRun = BigInt(n) * g.p.sharePrice + g.p.socialFundPerMeeting
  const runs = Number(g.totalMeetings - g.meeting)

  function create() {
    setErr(null)
    if (perRun > 25_000_000n) return setErr('Pilot limit: up to 25 USDT per run.')
    if (runs < 1) return setErr('There are no meetings left in this cycle.')
    const total = perRun * BigInt(runs)
    start({
      summary: {
        what: `Autosave into ${gname(g)}: ${n} share${n === 1 ? '' : 's'} every meeting`, amount: `${usdt(perRun)} USDT × up to ${runs} meetings = ${usdt(total)} USDT max`, chain: 'Polygon',
        extra: [['How often', intervalLabel(g.p.meetingInterval)], ['Each run', `${n} × ${usdt(g.p.sharePrice)} shares + ${usdt(g.p.socialFundPerMeeting)} social fund`], ['Stops', 'At Share-Out, or anytime you cancel']],
      },
      steps: [
        approveStep(evm, total),
        {
          label: 'Create the Autosave', chain: 'polygon',
          run: async () => signAndRelayVault('vault.createMandate', 'CreateMandate', evm, { owner: evm, amountPerRun: perRun, interval: g.p.meetingInterval, maxRuns: runs, expiry: g.p.cycleEnd, toGroup: true, destId: g.id, nonce: await vaultNonce(evm), deadline: deadline() }),
        },
      ],
    })
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Autosave into this group</h2>
      {active.map(m => (
        <div key={String(m.id)} className="rounded-2xl bg-canvas p-3 text-sm">
          <p className="font-semibold">{usdt(m.amountPerRun)} USDT per meeting · run {m.runs} of {m.maxRuns}</p>
          <p className="text-muted">Next run: {m.runs === 0 ? 'soon' : new Date(Number(m.lastRun + m.interval) * 1000).toLocaleString()}</p>
          <div className="mt-2"><Button variant="secondary" onClick={() => start({ summary: { what: 'Stop this group Autosave and remove Kittora\'s USDT allowance', chain: 'Polygon' }, steps: revokeMandateSteps(evm, m.id) })}>Stop</Button></div>
        </div>
      ))}
      {active.length === 0 && (
        <>
          <p className="text-sm text-muted">Kittora buys your shares and pays the social fund each meeting, so you are never marked as missed. Leave it off if you prefer to buy by hand; a run waits if you already bought that meeting.</p>
          <Field label="Shares each meeting">
            <select className="input" value={n} onChange={e => setN(Number(e.target.value))}>{Array.from({ length: g.p.maxSharesPerMeeting }, (_, i) => i + 1).map(k => <option key={k} value={k}>{k} ({usdt(BigInt(k) * g.p.sharePrice + g.p.socialFundPerMeeting)} USDT)</option>)}</select>
          </Field>
          {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
          <Button variant="secondary" onClick={create}>Set up Autosave</Button>
        </>
      )}
    </Card>
  )
}

function ShareOutCard({ evm, g, pf, start }: { evm: Address, g: GroupDetail, pf: Portfolio | undefined, start: Start }) {
  const me = g.me!
  const [dest, setDest] = useState('0')
  const pockets = (pf?.pockets ?? []).filter(p => p.kind !== 3)
  const estimate = !g.shareOutStarted ? (g.totalShares > 0n ? (g.cash * me.shares) / g.totalShares : 0n) + (g.memberCount ? g.socialFund / BigInt(g.memberCount) : 0n) : null

  if (me.claimed) return <Card><h2 className="font-bold">Share-Out</h2><p className="mt-1 text-sm font-semibold text-good">You have claimed your Share-Out. Find it in Activity.</p></Card>
  if (g.activeLoans > 0) {
    return (
      <Card className="space-y-2">
        <h2 className="font-bold">Share-Out</h2>
        <ErrorPanel error={makeError('blocked', undefined, `The cycle has ended. Share-Out opens once ${g.activeLoans === 1 ? 'the open loan is' : `all ${g.activeLoans} open loans are`} repaid or marked as defaulted (see Loans below).`)} />
      </Card>
    )
  }
  function claim() {
    const rollId = BigInt(dest)
    start({
      summary: {
        what: `Claim your Share-Out from ${gname(g)}`, amount: estimate !== null ? `about ${usdt(estimate)} USDT` : undefined, chain: 'Polygon',
        extra: [['To', rollId === 0n ? 'Your wallet' : `Your pocket ${pocketName(rollId, pockets.find(p => p.id === rollId)?.kind ?? 0)}`], ['Made of', 'Your part of the pool (savings + interest) + an equal part of the social fund']],
      },
      steps: [{ label: 'Claim Share-Out', chain: 'polygon', run: async () => signAndRelayGroup('group.claimShareOut', 'ClaimShareOut', evm, { member: evm, groupId: g.id, rollPocketId: rollId, nonce: await groupNonce(evm), deadline: deadline() }) }],
    })
  }
  return (
    <Card className="space-y-3 ring-2 ring-brand">
      <h2 className="text-lg font-bold">Share-Out is open</h2>
      {estimate !== null
        ? <p className="tabular text-3xl font-extrabold">{usdt(estimate)} <span className="text-base">USDT</span></p>
        : <p className="text-sm text-muted">Share-Out has started. Your amount is fixed from the pool at the first claim.</p>}
      {estimate !== null && <p className="text-sm text-muted">Your {me.shares.toString()} shares cost {usdt(me.shares * g.p.sharePrice)} USDT. The rest is your share of the interest and social fund.</p>}
      <Field label="Send it to">
        <select className="input" value={dest} onChange={e => setDest(e.target.value)}>
          <option value="0">My wallet</option>
          {pockets.map(p => <option key={String(p.id)} value={String(p.id)}>{pocketName(p.id, p.kind)} (keeps earning)</option>)}
        </select>
      </Field>
      {dest !== '0' && <p className="text-xs text-muted">Pilot limits apply to pockets (25 USDT per deposit, 100 USDT per person). If it is above them, claim to your wallet instead.</p>}
      <Button onClick={claim}>Claim my Share-Out</Button>
    </Card>
  )
}

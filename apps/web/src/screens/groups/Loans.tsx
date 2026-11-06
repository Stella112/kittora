import { useState } from 'react'
import type { Address } from 'viem'
import { defaultableAt, dueAt, groupName, loanCheck, loanReady, LoanStatus, same, short, valueOf, type GroupDetail, type LoanView } from '../../lib/group.ts'
import { deadline, groupNonce, relayOpen, signAndRelayGroup, usdtBalance, GROUP } from '../../lib/chainActions.ts'
import { parseUsdt } from '../../lib/amounts.ts'
import { approveStep } from '../../lib/steps.ts'
import { makeError } from '../../lib/errors.ts'
import { Button, Card, ErrorPanel, usdt } from '../../components/ui.tsx'
import { Field } from '../save/NewPocket.tsx'
import { durationLabel } from './NewGroup.tsx'
import type { Start } from './Group.tsx'

const DURATIONS = [3600, 86400, 604800, 1209600, 2592000] as const
const STATUS: Record<LoanStatus, [string, string]> = {
  [LoanStatus.None]: ['', ''],
  [LoanStatus.Requested]: ['Waiting for approvals', 'bg-warn-soft text-warn'],
  [LoanStatus.Disbursed]: ['Paid out', 'bg-brand-soft text-brand-strong'],
  [LoanStatus.Repaid]: ['Repaid', 'bg-good-soft text-good'],
  [LoanStatus.Defaulted]: ['Defaulted', 'bg-bad-soft text-bad'],
  [LoanStatus.Cancelled]: ['Cancelled', 'bg-canvas text-muted'],
}
const fmtDate = (s: bigint) => new Date(Number(s) * 1000).toLocaleString()

export function LoansSection({ evm, g, start, startNoMoney }: { evm: Address, g: GroupDetail, start: Start, startNoMoney: Start }) {
  const open = g.loans.filter(l => l.status === LoanStatus.Requested || l.status === LoanStatus.Disbursed)
  const past = g.loans.filter(l => l.status === LoanStatus.Repaid || l.status === LoanStatus.Defaulted)
  const now = g.now
  return (
    <>
      {open.map(l => <LoanCard key={String(l.id)} evm={evm} g={g} l={l} start={start} startNoMoney={startNoMoney} />)}
      {g.me!.activeLoan === 0n && now < g.p.cycleEnd && <RequestLoanCard evm={evm} g={g} start={start} />}
      {past.length > 0 && (
        <Card>
          <h2 className="font-bold">Past loans</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {past.map(l => (
              <li key={String(l.id)} className="flex justify-between gap-2">
                <span>#{l.id.toString()} · {same(l.borrower, evm) ? 'You' : short(l.borrower)} · {usdt(l.principal)} USDT</span>
                <span className={`rounded-full px-2 text-xs font-semibold leading-5 ${STATUS[l.status][1]}`}>{STATUS[l.status][0]}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function LoanCard({ evm, g, l, start, startNoMoney }: { evm: Address, g: GroupDetail, l: LoanView, start: Start, startNoMoney: Start }) {
  const [amt, setAmt] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const now = g.now
  const mine = same(l.borrower, evm)
  const gi = l.guarantors.findIndex(a => same(a, evm))
  const approvedByMe = l.approvedBy[evm.toLowerCase()] ?? false
  const ready = loanReady(l, g)
  const me = g.me!
  const label = mine ? 'Your loan' : `Loan for ${short(l.borrower)}`

  function approve() {
    const pledge = gi >= 0 ? l.pledges[gi] : 0n
    if (gi >= 0 && me.activeLoan !== 0n) return setErr('You have an open loan yourself, so you cannot guarantee another one until it is repaid.')
    if (gi >= 0 && me.shares - me.pledged < pledge) return setErr(`You need ${pledge} free shares to guarantee this loan.`)
    const f = {
      summary: {
        what: gi >= 0 ? `Guarantee loan #${l.id} and pledge ${pledge} of your shares` : `Approve loan #${l.id} for ${short(l.borrower)}`,
        amount: `${usdt(l.principal)} USDT loan`, chain: 'Polygon',
        extra: gi >= 0
          ? [['Your pledge', `${pledge} shares (worth ${usdt(valueOf(g, pledge))} USDT now)`] as [string, string], ['If it defaults', 'The unpaid part is cut from the borrower first, then from pledged shares'] as [string, string]]
          : [['Your money', 'Not touched'] as [string, string]],
      },
      steps: [{ label: gi >= 0 ? 'Guarantee the loan' : 'Approve the loan', chain: 'polygon' as const, run: async () => signAndRelayGroup('group.approveLoan', 'ApproveLoan', evm, { member: evm, loanId: l.id, nonce: await groupNonce(evm), deadline: deadline() }) }],
    }
    // a guarantor puts savings at risk: show the disclosure first
    ;(gi >= 0 ? start : startNoMoney)(f)
  }

  function payOut() {
    if (g.cash < l.principal) return setErr(`The pool has ${usdt(g.cash)} USDT free right now. The loan can be paid out once members save more or other loans are repaid.`)
    startNoMoney({
      summary: { what: `Pay out loan #${l.id} to ${mine ? 'you' : short(l.borrower)}`, amount: `${usdt(l.principal)} USDT`, chain: 'Polygon', extra: [['Due', `${durationLabel(l.duration)} after pay-out`], ['To repay', `${usdt(l.principal + l.interest)} USDT`]] },
      steps: [{ label: 'Pay out the loan', chain: 'polygon', signs: false, run: () => relayOpen('group.disburse', l.id) }],
    })
  }

  function cancel() {
    startNoMoney({
      summary: { what: `Cancel your loan request #${l.id}`, chain: 'Polygon', extra: [['Guarantors', 'Their pledged shares are released']] },
      steps: [{ label: 'Cancel the request', chain: 'polygon', run: async () => signAndRelayGroup('group.cancelLoan', 'CancelLoan', evm, { borrower: evm, loanId: l.id, nonce: await groupNonce(evm), deadline: deadline() }) }],
    })
  }

  async function repay(all: boolean) {
    setErr(null)
    const a = all ? l.owed : parseUsdt(amt)
    if (!a) return setErr('Enter an amount like 5 or 2.50')
    if (a > l.owed) return setErr(`Only ${usdt(l.owed)} USDT is left to repay.`)
    const bal = await usdtBalance(evm).catch(() => null)
    if (bal !== null && bal < a) return setErr(`You have ${usdt(bal)} USDT on Polygon.`)
    start({
      summary: { what: `Repay loan #${l.id}${mine ? '' : ` for ${short(l.borrower)}`}`, amount: `${usdt(a)} USDT`, chain: 'Polygon', extra: [['Left after this', `${usdt(l.owed - a)} USDT`], ['Order', 'Interest is paid first, then the loan']] },
      steps: [
        approveStep(evm, a, GROUP),
        { label: `Repay ${usdt(a)} USDT`, chain: 'polygon', run: async () => signAndRelayGroup('group.repay', 'Repay', evm, { payer: evm, loanId: l.id, amount: a, nonce: await groupNonce(evm), deadline: deadline() }) },
      ],
    })
  }

  function markDefault() {
    startNoMoney({
      summary: { what: `Mark loan #${l.id} as defaulted`, amount: `${usdt(l.owed)} USDT unpaid`, chain: 'Polygon', extra: [['Effect', 'Unpaid principal is written off from the borrower\'s shares, then guarantors\' pledged shares. Other members keep their value.']] },
      steps: [{ label: 'Mark as defaulted', chain: 'polygon', signs: false, run: () => relayOpen('group.markDefault', l.id) }],
    })
  }

  const due = l.status === LoanStatus.Disbursed ? dueAt(l) : null
  const canDefault = l.status === LoanStatus.Disbursed && now >= defaultableAt(l, g)
  const late = due !== null && now > due
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">{label}</h2>
          <p className="text-sm text-muted">#{l.id.toString()} · {usdt(l.principal)} USDT + {usdt(l.interest)} interest · {durationLabel(l.duration)}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${late ? 'bg-bad-soft text-bad' : STATUS[l.status][1]}`}>{late ? 'Late' : STATUS[l.status][0]}</span>
      </div>

      {l.status === LoanStatus.Requested && (
        <div className="text-sm">
          <p>Approvals: <b>{l.approvals} of {g.p.approvalsRequired}</b>{l.guarantors.length > 0 && <> · guarantors: <b>{l.guarantorApprovals} of {l.guarantors.length}</b></>}</p>
          {l.guarantors.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-muted">
              {l.guarantors.map((a, i) => <li key={a}>{l.approvedBy[a.toLowerCase()] ? '✓' : '○'} {same(a, evm) ? 'You pledge' : `${short(a)} pledges`} {l.pledges[i].toString()} shares</li>)}
            </ul>
          )}
        </div>
      )}
      {due !== null && (
        <div className="text-sm">
          <p>Left to repay: <b className="tabular">{usdt(l.owed)} USDT</b></p>
          <p className="text-muted">Due {fmtDate(due)}{late ? `; defaults after ${fmtDate(defaultableAt(l, g))}` : ''}</p>
        </div>
      )}

      {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}

      {l.status === LoanStatus.Requested && !mine && !approvedByMe && <Button onClick={approve}>{gi >= 0 ? `Guarantee (pledge ${l.pledges[gi]} shares)` : 'Approve'}</Button>}
      {l.status === LoanStatus.Requested && !mine && approvedByMe && <p className="text-sm font-semibold text-good">You approved this loan.</p>}
      {ready && <Button variant={mine ? 'primary' : 'secondary'} onClick={payOut}>Pay out the loan</Button>}
      {l.status === LoanStatus.Requested && mine && !ready && <p className="text-sm text-muted">Ask your members to approve it in Kittora. It can be paid out as soon as it has enough approvals.</p>}
      {l.status === LoanStatus.Requested && mine && <Button variant="ghost" onClick={cancel}>Cancel request</Button>}

      {l.status === LoanStatus.Disbursed && (mine || gi >= 0) && (
        <>
          <Field label="Repay amount (USDT)"><input className="input" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} placeholder={usdt(l.owed)} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => repay(false)}>Repay</Button>
            <Button onClick={() => repay(true)}>Repay all</Button>
          </div>
          {gi >= 0 && !mine && <p className="text-xs text-muted">As a guarantor you may repay for the borrower to protect your pledged shares.</p>}
        </>
      )}
      {canDefault && <Button variant="secondary" onClick={markDefault}>Mark as defaulted</Button>}
    </Card>
  )
}

function RequestLoanCard({ evm, g, start }: { evm: Address, g: GroupDetail, start: Start }) {
  const [amt, setAmt] = useState('')
  const now = g.now
  const durations = DURATIONS.filter(d => now + BigInt(d) <= g.p.cycleEnd)
  const [duration, setDuration] = useState<number>(durations.includes(604800) ? 604800 : durations[0] ?? 3600)
  const [pledges, setPledges] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string | null>(null)
  const me = g.me!
  const others = g.members.filter(m => !same(m.address, evm))
  const free = (m: typeof others[number]) => m.shares - m.pledged
  const principal = parseUsdt(amt) ?? 0n
  const chosen = others.map(m => ({ m, n: BigInt(Number(pledges[m.address]) || 0) })).filter(x => x.n > 0n)
  const c = loanCheck(g, me, principal, chosen.map(x => x.n))

  if (me.shares === 0n) return <Card><h2 className="font-bold">Borrow</h2><p className="mt-1 text-sm text-muted">Buy shares first. Your loan limit is based on your savings in the group.</p></Card>
  if (durations.length === 0) return null

  function review() {
    setErr(null)
    if (!principal) return setErr('Enter an amount like 5 or 2.50')
    if (c.overMultiple) return setErr(`The most you can borrow is ${usdt(c.multipleCap)} USDT (${g.p.maxLoanMultipleBps / 10000}× your ${usdt(c.ownValue)} USDT savings).`)
    if (c.needCover > 0n) return setErr(`Add guarantors to cover ${usdt(c.needCover)} USDT more.`)
    for (const x of chosen) {
      if (x.n > free(x.m)) return setErr(`${short(x.m.address)} has only ${free(x.m)} free shares.`)
      if (x.m.activeLoan !== 0n) return setErr(`${short(x.m.address)} has an open loan and cannot guarantee right now.`)
    }
    if (chosen.length > 10) return setErr('Up to 10 guarantors per loan.')
    const interest = (principal * BigInt(g.p.interestBps)) / 10_000n
    start({
      summary: {
        what: `Ask ${groupName(g.id)} for a loan`, amount: `${usdt(principal)} USDT`, chain: 'Polygon',
        extra: [
          ['Interest', `${usdt(interest)} USDT (${g.p.interestBps / 100}% flat)`],
          ['You repay', `${usdt(principal + interest)} USDT within ${durationLabel(BigInt(duration))} of pay-out`],
          ['Guarantors', chosen.length ? chosen.map(x => `${short(x.m.address)}: ${x.n} shares`).join(', ') : 'None (within your own savings)'],
          ['Approvals needed', `${g.p.approvalsRequired}${chosen.length ? ' + every guarantor' : ''}`],
          ['If late', `After ${durationLabel(g.p.gracePeriod)} grace, the unpaid part is taken from your shares first, then your guarantors'.`],
        ],
      },
      steps: [{
        label: 'Request the loan', chain: 'polygon',
        run: async () => signAndRelayGroup('group.requestLoan', 'RequestLoan', evm, { borrower: evm, groupId: g.id, principal, duration: BigInt(duration), guarantors: chosen.map(x => x.m.address), pledges: chosen.map(x => x.n), nonce: await groupNonce(evm), deadline: deadline() }),
      }],
    })
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Borrow from the pool</h2>
      <p className="text-sm text-muted">Without guarantors you can borrow up to your savings: <b className="text-ink">{usdt(c.ownValue)} USDT</b>. With guarantors, up to <b className="text-ink">{usdt(c.multipleCap)} USDT</b>. Free in the pool now: {usdt(g.cash)} USDT.</p>
      <Field label="Amount (USDT)"><input className="input" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} placeholder="5" /></Field>
      <Field label="Repay within">
        <select className="input" value={duration} onChange={e => setDuration(Number(e.target.value))}>{durations.map(d => <option key={d} value={d}>{d === 3600 ? '1 hour (pilot)' : durationLabel(BigInt(d))}</option>)}</select>
      </Field>
      {principal > c.ownValue && (
        <div className="space-y-2 rounded-2xl bg-canvas p-3">
          <p className="text-sm font-semibold">Guarantors pledge shares to cover {usdt(principal - c.ownValue)} USDT</p>
          {others.filter(m => free(m) > 0n && m.activeLoan === 0n).map(m => (
            <label key={m.address} className="flex items-center justify-between gap-3 text-sm">
              <span>{short(m.address)} <span className="text-muted">({free(m).toString()} free)</span></span>
              <input className="input max-w-24" inputMode="numeric" aria-label={`Shares pledged by ${short(m.address)}`} value={pledges[m.address] ?? ''} onChange={e => setPledges(p => ({ ...p, [m.address]: e.target.value.replace(/\D/g, '') }))} placeholder="0" />
            </label>
          ))}
          <p className="text-xs text-muted">{c.needCover > 0n ? `Still short by ${usdt(c.needCover)} USDT.` : 'Covered.'} Each guarantor approves in Kittora; their pledged shares are frozen until you repay.</p>
        </div>
      )}
      {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
      <Button variant="secondary" onClick={review}>Review loan request</Button>
    </Card>
  )
}

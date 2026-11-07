// A1.3 + A1.4 Members tab: role pills, Autosave or manual, meetings paid this cycle, missed meetings. Public to all
// members, as contributions are at a VSLA meeting.
import type { Address } from 'viem'
import { Role, same, short, type GroupDetail } from '../../lib/group.ts'
import type { GroupFeedRow } from '../../lib/relayer.ts'
import { Card } from '../../components/ui.tsx'

/** Role pill: the only place role names appear (A1 copy rule). Admin = emerald, Treasurer = gold. */
export function RolePill({ role }: { role: Role }) {
  if (role === Role.Admin) return <span className="ml-1 rounded-full bg-[#d1fae5] px-2 py-0.5 text-xs font-bold text-[#065f46]">Admin</span>
  if (role === Role.Treasurer) return <span className="ml-1 rounded-full bg-[#fef3c7] px-2 py-0.5 text-xs font-bold text-[#92400e]">Treasurer</span>
  return null
}

export interface MemberStats { paid: number, missed: number, joinedAt: number }

/** Paid / missed meetings per member from on-chain purchases (SharesBought carries the meeting index). */
export function memberStats(g: Pick<GroupDetail, 'startAt' | 'p' | 'meeting' | 'members'>, feed: GroupFeedRow[]): Record<string, MemberStats> {
  const paid = new Map<string, Set<number>>()
  const joined = new Map<string, number>()
  for (const i of feed) {
    const m = String(i.args.member ?? '').toLowerCase()
    if (i.event === 'SharesBought') {
      const set = paid.get(m) ?? new Set<number>()
      set.add(Number(i.args.meeting))
      paid.set(m, set)
    }
    if ((i.event === 'MemberJoined' || i.event === 'GroupCreated') && i.ts) {
      const who = i.event === 'GroupCreated' ? String(i.actor ?? '') : m
      const idx = Number((BigInt(i.ts) - g.startAt) / g.p.meetingInterval)
      const prev = joined.get(who)
      joined.set(who, prev === undefined ? Math.max(idx, 0) : Math.min(prev, Math.max(idx, 0)))
    }
  }
  const out: Record<string, MemberStats> = {}
  const current = Number(g.meeting)
  for (const mem of g.members) {
    const k = mem.address.toLowerCase()
    const set = paid.get(k) ?? new Set<number>()
    const from = joined.get(k) ?? 0
    let missed = 0
    for (let w = from; w < current; w++) if (!set.has(w)) missed++ // the current meeting is still open
    out[k] = { paid: set.size, missed, joinedAt: from }
  }
  return out
}

export function MembersTab({ g, evm, feed }: { g: GroupDetail, evm: Address, feed: GroupFeedRow[] }) {
  const stats = memberStats(g, feed)
  const onAutosave = new Set(g.mandates.filter(m => m.active).map(m => m.owner.toLowerCase()))
  const misses = new Map<string, string>()
  for (const w of g.autosaveWindows) if (w.status === 'failed' && w.windowIdx >= Number(g.meeting) - 1) misses.set(w.member.toLowerCase(), w.reason ?? 'Autosave run failed')
  return (
    <Card>
      <h2 className="font-bold">Members</h2>
      <p className="text-xs text-muted">Contributions are public to the group, as at a meeting. Meeting {Number(g.meeting) + 1} of {g.totalMeetings} is open now.</p>
      <ul className="mt-3 divide-y divide-line">
        {g.members.map(m => {
          const k = m.address.toLowerCase()
          const s = stats[k] ?? { paid: 0, missed: 0, joinedAt: 0 }
          const auto = onAutosave.has(k)
          return (
            <li key={m.address} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{same(m.address, evm) ? 'You' : short(m.address)}<RolePill role={m.role} /></p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${auto ? 'bg-good-soft text-good' : 'bg-canvas text-muted'}`}>{auto ? 'On autosave' : 'Manual'}</span>
              </div>
              <p className="tabular mt-1 text-sm text-muted">
                {m.shares.toString()} share{m.shares === 1n ? '' : 's'} · paid {s.paid} meeting{s.paid === 1 ? '' : 's'} this cycle
                {s.missed > 0 ? <span className="text-bad"> · missed {s.missed}</span> : ''}
                {m.activeLoan !== 0n ? ' · has a loan' : ''}
              </p>
              {misses.has(k) && <p className="text-xs text-bad">Last Autosave failed: {misses.get(k)}</p>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

// A1.1 + A1.4: what only the Admin can do. Nothing here moves money: roles never change the money rules.
import { useState } from 'react'
import type { Address } from 'viem'
import { byteLen, Role, same, short, type GroupDetail } from '../../lib/group.ts'
import { deadline, groupNonce, signAndRelayGroup } from '../../lib/chainActions.ts'
import { COVERS, coverStyle } from '../../lib/covers.ts'
import { makeError } from '../../lib/errors.ts'
import { Button, Card, ErrorPanel } from '../../components/ui.tsx'
import { Field } from '../save/NewPocket.tsx'
import { RolePill } from './Members.tsx'
import type { Start } from './Group.tsx'

export function CoverPicker({ value, onChange }: { value: number, onChange: (id: number) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Cover">
      {COVERS.map(c => (
        <button key={c.id} type="button" role="radio" aria-checked={value === c.id} aria-label={c.name} onClick={() => onChange(c.id)}
          className={`h-14 rounded-2xl ${value === c.id ? 'ring-4 ring-brand' : 'ring-1 ring-line'}`} style={coverStyle(c.id)} />
      ))}
    </div>
  )
}

export function profileError(name: string, purpose: string): string | null {
  const n = byteLen(name.trim())
  if (n === 0) return 'Give the group a name.'
  if (n > 32) return 'Keep the name under 32 characters.'
  if (byteLen(purpose.trim()) > 80) return 'Keep the purpose under 80 characters.'
  return null
}

export function AdminPanel({ g, evm, startNoMoney }: { g: GroupDetail, evm: Address, startNoMoney: Start }) {
  const [name, setName] = useState(g.profile.name)
  const [purpose, setPurpose] = useState(g.profile.purpose)
  const [coverId, setCoverId] = useState(g.profile.coverId)
  const [newAdmin, setNewAdmin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const others = g.members.filter(m => !same(m.address, evm))
  const removable = others.filter(m => m.shares === 0n && m.activeLoan === 0n && m.pledged === 0n && !g.shareOutStarted)
  const sign = (label: string, run: (n: bigint) => Promise<`0x${string}`>) => ({ label, chain: 'polygon' as const, run: async () => run(await groupNonce(evm)) })

  function saveProfile() {
    setErr(null)
    const e = profileError(name, purpose)
    if (e) return setErr(e)
    const n = name.trim()
    const pu = purpose.trim()
    startNoMoney({
      summary: { what: 'Update the group profile', chain: 'Polygon', extra: [['Name', n], ['Purpose', pu || '(none)'], ['Cover', COVERS[coverId].name]] },
      steps: [sign('Save the profile', nonce => signAndRelayGroup('group.updateProfile', 'UpdateProfile', evm, { admin: evm, groupId: g.id, name: n, purpose: pu, coverId, nonce, deadline: deadline() }))],
    })
  }

  function treasurer(member: Address, enabled: boolean) {
    setErr(null)
    if (enabled && g.treasurers.length >= 2) return setErr('A group has at most 2 Treasurers.')
    startNoMoney({
      summary: { what: enabled ? `Make ${short(member)} a Treasurer` : `Remove ${short(member)} as Treasurer`, chain: 'Polygon', extra: [['What it means', 'A Treasurer must approve every social fund payment. No role can move the pool.']] },
      steps: [sign(enabled ? 'Assign Treasurer' : 'Remove Treasurer', nonce => signAndRelayGroup('group.setTreasurer', 'SetTreasurer', evm, { admin: evm, groupId: g.id, member, enabled, nonce, deadline: deadline() }))],
    })
  }

  function transfer() {
    setErr(null)
    if (!newAdmin) return setErr('Choose who becomes Admin.')
    const to = newAdmin as Address
    startNoMoney({
      summary: { what: `Hand the Admin role to ${short(to)}`, chain: 'Polygon', extra: [['After this', 'You become a Member and can no longer edit the profile or roles.'], ...(g.treasurers.some(t => same(t, to)) ? [['Note', 'They stop being a Treasurer (an Admin cannot be one).'] as [string, string]] : [])] },
      steps: [sign('Transfer Admin', nonce => signAndRelayGroup('group.transferAdmin', 'TransferAdmin', evm, { admin: evm, groupId: g.id, newAdmin: to, nonce, deadline: deadline() }))],
    })
  }

  function remove(member: Address) {
    setErr(null)
    startNoMoney({
      summary: { what: `Remove ${short(member)} from the group`, chain: 'Polygon', extra: [['Allowed because', 'They hold no shares, no loan and no pledge. Nothing of value leaves the group.']] },
      steps: [sign('Remove the member', nonce => signAndRelayGroup('group.removeMember', 'RemoveMember', evm, { admin: evm, groupId: g.id, member, nonce, deadline: deadline() }))],
    })
  }

  return (
    <div className="space-y-4">
      {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
      <Card className="space-y-3">
        <h2 className="font-bold">Group profile</h2>
        <Field label="Name"><input className="input" value={name} maxLength={32} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Purpose (optional)"><input className="input" value={purpose} maxLength={80} onChange={e => setPurpose(e.target.value)} placeholder="Market traders, Yaba" /></Field>
        <span className="block text-sm font-semibold">Cover</span>
        <CoverPicker value={coverId} onChange={setCoverId} />
        <Button variant="secondary" onClick={saveProfile}>Save profile</Button>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-bold">Treasurers ({g.treasurers.length} of 2)</h2>
        <p className="text-sm text-muted">Every social fund payment needs a Treasurer's approval. With no Treasurer, yours counts instead.</p>
        <ul className="divide-y divide-line">
          {others.map(m => (
            <li key={m.address} className="flex items-center justify-between gap-2 py-2">
              <span className="font-semibold">{short(m.address)}<RolePill role={m.role} /></span>
              <div className="w-36">
                {m.role === Role.Treasurer
                  ? <Button variant="ghost" onClick={() => treasurer(m.address, false)}>Remove role</Button>
                  : <Button variant="secondary" disabled={g.treasurers.length >= 2} onClick={() => treasurer(m.address, true)}>Make Treasurer</Button>}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-bold">Hand over Admin</h2>
        <select className="input" value={newAdmin} onChange={e => setNewAdmin(e.target.value)} aria-label="New Admin">
          <option value="">Choose a member…</option>
          {others.map(m => <option key={m.address} value={m.address}>{short(m.address)}</option>)}
        </select>
        <Button variant="secondary" onClick={transfer} disabled={others.length === 0}>Transfer Admin</Button>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-bold">Remove a member</h2>
        <p className="text-sm text-muted">Only members with no shares, no open loan and no pledge can be removed.</p>
        {removable.length === 0 && <p className="text-sm text-muted">No member can be removed right now.</p>}
        {removable.map(m => (
          <div key={m.address} className="flex items-center justify-between gap-2">
            <span className="font-semibold">{short(m.address)}</span>
            <div className="w-32"><Button variant="ghost" onClick={() => remove(m.address)}>Remove</Button></div>
          </div>
        ))}
      </Card>
    </div>
  )
}

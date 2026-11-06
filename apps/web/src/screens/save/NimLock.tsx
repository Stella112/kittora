// NIM SafeLock (bonded). The NIM stays in the user's own staking position; Kittora cannot move it. The user locks a
// USDT bond in PocketVault tied to a date and their Nimiq address. Early unstake → bond forfeited by the attester.
import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Abi, Address } from 'viem'
import { PocketVaultAbi, linkMessage, linkHash } from '@kittora/core'
import { useSession } from '../../state/session.tsx'
import { usePortfolio, type BondView } from '../../lib/portfolio.ts'
import { formatNim, parseNimToLuna, parseUsdt } from '../../lib/amounts.ts'
import { deadline, signAndRelayVault, usdtBalance, VAULT, vaultNonce } from '../../lib/chainActions.ts'
import { approveStep } from '../../lib/steps.ts'
import { nimiqProvider, unwrap } from '../../lib/nimiq.ts'
import { reader } from '../../lib/evm.ts'
import { config } from '../../config.ts'
import { classify, makeError } from '../../lib/errors.ts'
import { Button, Card, ErrorPanel, Spinner, usdt } from '../../components/ui.tsx'
import { RequireEvm } from '../../components/RequireEvm.tsx'
import { TxFlow, type Summary, type TxStep } from '../../components/TxFlow.tsx'
import { Field } from './NewPocket.tsx'
import { nimiqToHex } from '../../lib/nimiqAddress.ts'

const VALIDATOR = (import.meta.env.VITE_NIM_VALIDATOR as string | undefined) ?? ''

async function staker(address: string): Promise<{ active: number, found: boolean }> {
  const res = await fetch(`${config.relayerUrl}/nimiq/staker/${encodeURIComponent(address)}`).catch(() => null)
  if (!res?.ok) throw makeError('rpc_down', undefined, 'We could not read your NIM stake. Please retry.')
  return res.json()
}

type Flow = { summary: Summary, steps: TxStep[] } | null

export function NimLock() {
  return (
    <div className="space-y-4 pt-2">
      <Link to="/save" className="text-sm font-semibold text-brand-strong">← My Kitty</Link>
      <h1 className="text-2xl font-bold">NIM SafeLock</h1>
      <Card className="space-y-2 text-sm">
        <p><b>This is a bonded lock, not a hard lock.</b> Your NIM stays staked in your own Nimiq Pay wallet and keeps earning staking rewards. Kittora can never move it.</p>
        <p>You add a <b>USDT bond</b>. If your active stake drops below the amount before your date, the bond goes to your group's social fund (or is burned if you pick no group). After the date you claim the bond back.</p>
        <p className="text-muted">An attester key run by Kittora reports early unstakes and publishes the Nimiq transaction as evidence. That is a trust assumption.</p>
      </Card>
      <RequireEvm>{evm => <Body evm={evm} />}</RequireEvm>
    </div>
  )
}

function Body({ evm }: { evm: Address }) {
  const { nimiqAddress } = useSession()
  const qc = useQueryClient()
  const q = usePortfolio(evm)
  const stake = useQuery({ queryKey: ['staker', nimiqAddress], queryFn: () => staker(nimiqAddress!), enabled: Boolean(nimiqAddress) })
  const claimDelay = useQuery({ queryKey: ['claimDelay'], queryFn: () => reader().readContract({ address: VAULT(), abi: PocketVaultAbi as Abi, functionName: 'claimDelay' }) as Promise<bigint> })
  const [flow, setFlow] = useState<Flow>(null)
  const [nim, setNim] = useState('')
  const [bond, setBond] = useState('')
  const [days, setDays] = useState('30')
  const [group, setGroup] = useState('0')
  const [err, setErr] = useState<string | null>(null)

  if (!nimiqAddress) return <ErrorPanel error={makeError('not_in_nimiq_pay')} />
  if (flow) return <TxFlow owner={evm} summary={flow.summary} steps={flow.steps} onDone={async () => { setFlow(null); await qc.invalidateQueries() }} onCancel={() => setFlow(null)} />

  async function review() {
    setErr(null)
    if (!VALIDATOR) return setErr('The staking validator is not configured yet.')
    const luna = parseNimToLuna(nim)
    const b = parseUsdt(bond)
    const d = Number(days)
    if (!luna) return setErr('Enter how much NIM to lock.')
    if (!b) return setErr('Enter a bond amount in USDT.')
    if (b > 25_000_000n) return setErr('Pilot limit: up to 25 USDT per bond.')
    if (!Number.isInteger(d) || d < 1 || d > 3650) return setErr('Choose 1 to 3650 days.')
    const bal = await usdtBalance(evm).catch(() => null)
    if (bal !== null && bal < b) return setErr(`You have ${usdt(bal)} USDT on Polygon.`)
    const unlockAt = BigInt(Math.floor(Date.now() / 1000) + d * 86400)
    const groupId = BigInt(group)
    const addr = nimiqAddress!

    const stakeStep: TxStep = {
      label: `Stake ${formatNim(luna)} NIM with your validator`,
      chain: 'nimiq',
      skip: async () => BigInt((await staker(addr)).active) >= luna,
      run: async () => {
        const p = await nimiqProvider()
        const s = await staker(addr)
        const need = Number(luna - BigInt(s.active))
        return s.found
          ? unwrap(await p.sendStakeTransaction({ value: need }))
          : unwrap(await p.sendNewStakerTransaction({ delegation: VALIDATOR, value: Number(luna) }))
      },
      confirm: async () => {
        const start = Date.now()
        while (Date.now() - start < 5 * 60_000) {
          if (BigInt((await staker(addr)).active) >= luna) return
          await new Promise(r => setTimeout(r, 5000))
        }
        throw Object.assign(new Error('stake not visible yet'), { error: 'pending' })
      },
    }

    const lockStep: TxStep = {
      label: 'Link your Nimiq address and lock the bond',
      chain: 'polygon',
      run: async () => {
        const nonce = await vaultNonce(evm)
        const message = linkMessage({ nimiqAddress: addr, evmAddress: evm, lockNonce: nonce, chainId: config.chainId, vault: VAULT(), nimLuna: luna, unlockAt })
        const p = await nimiqProvider()
        const sig = unwrap(await p.sign(message))
        const lh = linkHash(message, sig.publicKey, sig.signature)
        return signAndRelayVault('vault.lockBond', 'LockBond', evm,
          { owner: evm, amount: b, unlockAt, nimiqAddress: nimiqToHex(addr), nimLuna: luna, groupId, linkHash: lh, nonce, deadline: deadline() },
          { nimiqLink: { nimiqAddress: addr, publicKey: sig.publicKey, signature: sig.signature } })
      },
    }

    setFlow({
      summary: {
        what: 'Lock a NIM SafeLock bond',
        amount: `${formatNim(luna)} NIM staked + ${usdt(b)} USDT bond`,
        chain: 'Nimiq (stake) and Polygon (bond)',
        extra: [
          ['Until', new Date(Number(unlockAt) * 1000).toLocaleString()],
          ['If you unstake early', groupId ? `Bond goes to group #${groupId} social fund` : 'Bond is burned'],
          ['Your NIM', 'Stays in your wallet, still earning'],
        ],
      },
      steps: [stakeStep, approveStep(evm, b), lockStep],
    })
  }

  function claim(bondItem: BondView) {
    setFlow({
      summary: { what: 'Claim your NIM SafeLock bond back', amount: `${usdt(bondItem.assets)} USDT (incl. yield)`, chain: 'Polygon' },
      steps: [{
        label: 'Claim bond', chain: 'polygon',
        run: async () => signAndRelayVault('vault.claimBond', 'ClaimBond', evm, { owner: evm, bondId: bondItem.id, nonce: await vaultNonce(evm), deadline: deadline() }),
      }],
    })
  }

  const now = BigInt(Math.floor(Date.now() / 1000))
  return (
    <>
      {q.isLoading && <Spinner label="Loading…" />}
      {q.error && <ErrorPanel error={classify(q.error)} onRetry={() => q.refetch()} compact />}
      {q.data?.bonds.map(b => {
        const opensAt = b.unlockAt + (claimDelay.data ?? 3600n)
        return (
          <Card key={String(b.id)} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="font-semibold">{formatNim(b.nimLuna)} NIM</p>
              <p className="tabular font-bold">{usdt(b.assets)} USDT</p>
            </div>
            <p className="text-sm text-muted">{['', 'Active', 'Claimed', 'Forfeited (early unstake)'][b.status]} · until {new Date(Number(b.unlockAt) * 1000).toLocaleString()}</p>
            {b.status === 1 && (now > opensAt
              ? <Button onClick={() => claim(b)}>Claim bond</Button>
              : <p className="text-sm">Claim opens {new Date(Number(opensAt) * 1000).toLocaleString()}. Keep your NIM staked until then.</p>)}
          </Card>
        )
      })}

      <Card className="space-y-3">
        <h2 className="font-bold">New NIM SafeLock</h2>
        <p className="text-sm text-muted">Active stake now: {stake.isLoading ? '…' : stake.data ? `${formatNim(stake.data.active)} NIM` : 'unknown'}</p>
        {stake.error && <ErrorPanel error={classify(stake.error)} onRetry={() => stake.refetch()} compact />}
        <Field label="NIM to keep staked"><input className="input" inputMode="decimal" value={nim} onChange={e => setNim(e.target.value)} placeholder="1000" /></Field>
        <Field label="Bond (USDT)"><input className="input" inputMode="decimal" value={bond} onChange={e => setBond(e.target.value)} placeholder="5" /></Field>
        <Field label="Lock for (days)"><input className="input" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} /></Field>
        <Field label="If I unstake early, the bond goes to">
          <select className="input" value={group} onChange={e => setGroup(e.target.value)}>
            <option value="0">Nobody: burn it</option>
            {q.data?.groups.map(g => <option key={String(g.id)} value={String(g.id)}>Group #{String(g.id)} social fund</option>)}
          </select>
        </Field>
        {err && <ErrorPanel error={makeError('blocked', err, err)} compact />}
        <Button onClick={review}>Review</Button>
      </Card>
    </>
  )
}

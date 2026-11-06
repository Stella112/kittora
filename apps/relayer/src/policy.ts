// Relay pipeline. Order: known action → schema → deadline → nonce (replay) → signature (forgery) → rate limit
// → action-specific checks → simulate → gas cap → queued send. Every rejection has a stable code (tested).
import { verifyTypedData, encodeFunctionData, parseSignature, type Address, type Hex, type PublicClient } from 'viem'
import { vaultDomain, groupDomain, usdtMetaTxTyped, linkMessage, linkHash as computeLinkHash } from '@kittora/core'
import { ACTIONS, ABIS, TYPES, usdtAbi } from './actions.ts'
import { RelayError, type TxSender } from './chain.ts'
import { verifyNimiqSignature, nimiqToBytes20, type NimiqRpc } from './nimiq.ts'
import { rateHits, relays, and, eq, gt, sql, type Db } from './db.ts'

export interface RelayRequest {
  action: string
  params: Record<string, unknown>
  signature?: string
  nimiqLink?: { nimiqAddress: string, publicKey: string, signature: string }
}

export interface Deps {
  pub: PublicClient
  sender: TxSender
  db: Db
  nimiq: NimiqRpc
  chainId: number
  addresses: { vault: Address, group: Address, usdt: Address }
  rateLimitPerHour: number
  now?: () => number
}

let tokenNameCache: string | null = null

export async function handleRelay(req: RelayRequest, deps: Deps, clientKey: string): Promise<{ hash: Hex }> {
  const spec = ACTIONS[req.action]
  if (!spec) throw new RelayError('unknown_action', `action not allowed: ${String(req.action)}`)
  const parsed = spec.schema.safeParse(req.params)
  if (!parsed.success) throw new RelayError('bad_params', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
  const p = parsed.data as Record<string, any>
  const now = BigInt(Math.floor((deps.now ?? Date.now)() / 1000))
  const target = deps.addresses[spec.target]
  const abi = ABIS[spec.target]

  // permissionless (contract enforces all rules)
  if (!spec.primaryType || !spec.signerField) {
    await rateLimit(deps, `anon:${clientKey}`)
    const hash = await deps.sender.send(target, abi, spec.fn, spec.args(p, '0x'))
    await record(deps, hash, req.action, `anon:${clientKey}`)
    return { hash }
  }

  const signer = p[spec.signerField] as Address
  const sig = req.signature
  if (!sig || !/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new RelayError('bad_signature', 'signature must be 65 bytes hex')

  if ('deadline' in p && (p.deadline as bigint) < now) throw new RelayError('expired', 'request deadline has passed')

  // nonce / replay
  const onchainNonce = spec.target === 'usdt'
    ? await deps.pub.readContract({ address: target, abi: usdtAbi, functionName: 'getNonce', args: [signer] }) as bigint
    : await deps.pub.readContract({ address: target, abi, functionName: 'nonces', args: [signer] }) as bigint
  if ((p.nonce as bigint) < onchainNonce) throw new RelayError('replayed', `nonce ${p.nonce} already used (current ${onchainNonce})`)
  if ((p.nonce as bigint) > onchainNonce) throw new RelayError('bad_nonce', `nonce ${p.nonce} is ahead of current ${onchainNonce}`)

  // signature
  let args: readonly unknown[]
  if (spec.target === 'usdt') {
    if (p.spender !== deps.addresses.vault.toLowerCase() && p.spender !== deps.addresses.group.toLowerCase()) {
      throw new RelayError('bad_spender', 'approve spender must be the Kittora vault or group contract')
    }
    tokenNameCache ??= await deps.pub.readContract({ address: target, abi: usdtAbi, functionName: 'name' }) as string
    const functionSignature = encodeFunctionData({ abi: usdtAbi, functionName: 'approve', args: [p.spender, p.amount] })
    const td = usdtMetaTxTyped(tokenNameCache, signer, p.nonce, functionSignature, deps.chainId)
    await mustVerify(signer, { ...td, domain: { ...td.domain, verifyingContract: target } }, sig as Hex)
    const { r, s, v, yParity } = parseSignature(sig as Hex)
    args = [signer, functionSignature, r, s, Number(v ?? BigInt(yParity + 27))]
  } else {
    const domain = spec.target === 'vault' ? vaultDomain(target, deps.chainId) : groupDomain(target, deps.chainId)
    const message = { ...p }
    await mustVerify(signer, { domain, types: { [spec.primaryType]: TYPES[spec.primaryType] }, primaryType: spec.primaryType, message }, sig as Hex)
    args = spec.args(p, sig as Hex)
  }

  await rateLimit(deps, signer)

  if (req.action === 'vault.lockBond') await checkNimiqLink(req, p, deps)

  const hash = await deps.sender.send(target, abi, spec.fn, args)
  await record(deps, hash, req.action, signer)
  return { hash }
}

async function mustVerify(address: Address, td: any, signature: Hex) {
  let ok = false
  try {
    ok = await verifyTypedData({ address, ...td, signature })
  } catch {
    ok = false
  }
  if (!ok) throw new RelayError('bad_signature', 'signature does not match signer')
}

async function rateLimit(deps: Deps, key: string) {
  const since = Math.floor((deps.now ?? Date.now)() / 1000) - 3600
  const row = await deps.db.select({ n: sql<number>`count(*)` }).from(rateHits).where(and(eq(rateHits.key, key), gt(rateHits.ts, since))).get()
  if ((row?.n ?? 0) >= deps.rateLimitPerHour) throw new RelayError('rate_limited', `more than ${deps.rateLimitPerHour} requests in the last hour`, 429)
  await deps.db.insert(rateHits).values({ key, ts: since + 3600 })
}

async function record(deps: Deps, hash: Hex, action: string, signer: string) {
  await deps.db.insert(relays).values({ hash, action, signer, createdAt: Math.floor(Date.now() / 1000) })
}

/** NIM SafeLock: verify the Nimiq link signature, its hash, and that the stake is already in place. */
async function checkNimiqLink(req: RelayRequest, p: Record<string, any>, deps: Deps) {
  const l = req.nimiqLink
  if (!l) throw new RelayError('bad_link', 'nimiqLink is required for lockBond')
  let signerNimiq: string
  const message = linkMessage({
    nimiqAddress: l.nimiqAddress, evmAddress: p.owner, lockNonce: p.nonce, chainId: deps.chainId,
    vault: deps.addresses.vault, nimLuna: p.nimLuna, unlockAt: p.unlockAt,
  })
  try {
    signerNimiq = verifyNimiqSignature(message, l.publicKey, l.signature)
  } catch {
    throw new RelayError('bad_link', 'Nimiq link signature invalid')
  }
  if (nimiqToBytes20(signerNimiq).toLowerCase() !== String(p.nimiqAddress).toLowerCase()) throw new RelayError('bad_link', 'Nimiq address does not match the signing key')
  if (computeLinkHash(message, l.publicKey, l.signature) !== p.linkHash) throw new RelayError('bad_link', 'linkHash mismatch')
  const { active } = await deps.nimiq.activeStake(signerNimiq)
  if (BigInt(active) < (p.nimLuna as bigint)) throw new RelayError('stake_missing', `active stake ${active} luna is below the bonded ${p.nimLuna}`)
}

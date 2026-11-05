// THROWAWAY Gate 0 spike page. Every result is printed raw so it can be pasted into docs/SPIKE.md.
import { init, getHostNetwork, getHostLanguage, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { encodeFunctionData, parseAbi, toHex, pad } from 'viem'

const $ = (id: string) => document.getElementById(id)!
const out = (id: string, v: unknown) => { $(id).textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2) }
const err = (e: any) => ({ error: e?.message ?? String(e), type: e?.type, code: e?.code, data: e?.data })
const api = async (path: string, body?: unknown) => {
  const r = await fetch('/api' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const j = await r.json(); if (!r.ok) throw new Error(j.error); return j
}
const eth = (window as any).ethereum
const USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
const luna = () => Math.round(Number((($('nim') as HTMLInputElement).value || '0')) * 1e5) // 1 NIM = 1e5 Luna (SDK docs)

let nimiq: NimiqProvider | null = null
let nimAddr = ''
async function nq() {
  if (!nimiq) nimiq = await init({ timeout: 8000 })
  return nimiq
}

out('env', {
  ua: navigator.userAgent, hostNetwork: getHostNetwork() ?? 'undefined', hostLanguage: getHostLanguage() ?? 'undefined',
  hasWindowNimiq: !!(window as any).nimiq, hasEthereum: !!eth, width: innerWidth,
})

$('s1').onclick = async () => {
  try {
    const p = await nq()
    const accounts = await p.listAccounts(); nimAddr = accounts[0]
    const ch = await api('/challenge')
    const sig = await p.sign(ch.message)
    const v = await api('/s1', { address: nimAddr, message: ch.message, nonce: ch.nonce, ...sig })
    out('o1', { accounts, sig, server: v })
  } catch (e) { out('o1', err(e)) }
}

document.querySelectorAll<HTMLButtonElement>('[data-s2]').forEach((b) => b.onclick = async () => {
  try {
    const p = await nq(); const value = luna()
    const delegation = ($('validator') as HTMLInputElement).value.trim()
    const kind = b.dataset.s2
    const r = kind === 'new' ? await p.sendNewStakerTransaction({ delegation, value })
      : kind === 'add' ? await p.sendStakeTransaction({ value })
      : kind === 'retire' ? await p.sendRetireStakeTransaction({ retireStake: value })
      : await p.sendRemoveStakeTransaction({ value })
    out('o2', { kind, value, result: r })
  } catch (e) { out('o2', err(e)) }
})

$('s3').onclick = async () => {
  try {
    const p = await nq()
    if (!nimAddr) nimAddr = (await p.listAccounts())[0]
    const recipient = ($('stampTo') as HTMLInputElement).value.trim() || nimAddr
    const data = `KTR1|spike|contribution|g:0|${Date.now()}`
    const r = await p.sendBasicTransactionWithData({ recipient, value: 1000, data })
    out('o3', { recipient, data, result: r })
  } catch (e) { out('o3', err(e)) }
}

async function evmAccount() {
  const [a] = await eth.request({ method: 'eth_requestAccounts' })
  await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] })
  return a as string
}
async function signTyped(addr: string, typedData: any) {
  return eth.request({ method: 'eth_signTypedData_v4', params: [addr, JSON.stringify(typedData)] }) as Promise<string>
}

$('s4').onclick = async () => {
  try {
    const addr = await evmAccount()
    const chainId = await eth.request({ method: 'eth_chainId' })
    const typedData = {
      domain: { name: 'KittoraSpike', version: '1', chainId: 137, verifyingContract: '0x0000000000000000000000000000000000000001' },
      types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
        Hello: [{ name: 'who', type: 'address' }, { name: 'n', type: 'uint256' }] },
      primaryType: 'Hello', message: { who: addr, n: '42' },
    }
    const signature = await signTyped(addr, typedData)
    out('o4', { addr, chainId, signature, server: await api('/s4', { typedData, signature, address: addr }) })
  } catch (e) { out('o4', err(e)) }
}

const amt = () => String(Math.round(Number(($('usdt') as HTMLInputElement).value) * 1e6))
$('s5state').onclick = async () => {
  try { const a = await evmAccount(); out('o5', { user: a, ...(await api('/s5/state?user=' + a)) }) } catch (e) { out('o5', err(e)) }
}
$('s5approve').onclick = async () => {
  try {
    const user = await evmAccount(); const st = await api('/s5/state?user=' + user)
    const functionSignature = encodeFunctionData({ abi: parseAbi(['function approve(address,uint256)']), functionName: 'approve', args: [st.vault, BigInt(amt())] })
    // Mirrors Nimiq Pay signTokenApproval: domain {name, version '1', verifyingContract, salt = chainId as bytes32}
    const typedData = {
      domain: { name: st.tokenName, version: '1', verifyingContract: USDT, salt: pad(toHex(137), { size: 32 }) },
      types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'verifyingContract', type: 'address' }, { name: 'salt', type: 'bytes32' }],
        MetaTransaction: [{ name: 'nonce', type: 'uint256' }, { name: 'from', type: 'address' }, { name: 'functionSignature', type: 'bytes' }] },
      primaryType: 'MetaTransaction', message: { nonce: st.tokenNonce, from: user, functionSignature },
    }
    const signature = await signTyped(user, typedData)
    out('o5', { step: 'approve', relay: await api('/s5/approve', { user, functionSignature, signature }) })
  } catch (e) { out('o5', err(e)) }
}
async function vaultAction(action: 'deposit' | 'withdraw') {
  try {
    const owner = await evmAccount(); const st = await api('/s5/state?user=' + owner)
    const deadline = String(Math.floor(Date.now() / 1000) + 600)
    const typedData = {
      domain: { name: 'KittoraSpikeVault', version: '1', chainId: 137, verifyingContract: st.vault },
      types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
        [action === 'deposit' ? 'Deposit' : 'Withdraw']: [{ name: 'owner', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: action === 'deposit' ? 'Deposit' : 'Withdraw',
      message: { owner, amount: amt(), nonce: st.vaultNonce, deadline },
    }
    const signature = await signTyped(owner, typedData)
    out('o5', { step: action, relay: await api('/s5/vault', { action, owner, amount: amt(), deadline, signature }) })
  } catch (e) { out('o5', err(e)) }
}
$('s5deposit').onclick = () => vaultAction('deposit')
$('s5withdraw').onclick = () => vaultAction('withdraw')

$('s7').onclick = async () => {
  try {
    const p = await nq(); const accounts = await p.listAccounts()
    p.on('accountsChanged', (a) => out('o7', { accountsChanged: a }))
    const balances = await Promise.all(accounts.map((a) => p.getBalance(a)))
    out('o7', { accounts, balancesLuna: balances, network: p.getNetwork(), block: await p.getBlockNumber() })
  } catch (e) { out('o7', err(e)) }
}

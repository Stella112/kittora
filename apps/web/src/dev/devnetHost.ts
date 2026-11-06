// DEVNET ONLY. Loaded from main.tsx when `vite --mode devnet`; the import sits behind a build-time constant, so
// production bundles do not contain this file. It stands in for the Nimiq Pay host on a local anvil fork
// (apps/relayer/scripts/devnet.ts): the "wallet" is one of anvil's unlocked dev accounts, and typed-data signing is
// done by anvil itself. Switch member with ?as=0|1|2. Never point this at a real network.
type Req = { method: string, params?: unknown[] }

const rpc = import.meta.env.VITE_DEVNET_RPC as string
const members = String(import.meta.env.VITE_DEVNET_MEMBERS ?? '').split(',').filter(Boolean)

function pickMember(): number {
  const q = new URLSearchParams(location.search).get('as')
  try {
    if (q !== null) sessionStorage.setItem('devnet:as', q)
    return Number(sessionStorage.getItem('devnet:as') ?? 0) % members.length
  } catch {
    return Number(q ?? 0) % members.length
  }
}

export function installDevnetHost() {
  if (!rpc || members.length === 0) return
  const i = pickMember()
  const account = members[i]
  let id = 0
  const w = window as unknown as Record<string, unknown>
  w.nimiq = { devnet: true } // makes host detection report "inside Nimiq Pay" after the SDK timeout
  w.ethereum = {
    async request({ method, params }: Req) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account]
      if (method === 'eth_chainId') return '0x89'
      if (method === 'wallet_switchEthereumChain') return null
      const res = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: params ?? [] }) })
      const body = await res.json() as { result?: unknown, error?: { message: string, code: number, data?: unknown } }
      if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code, data: body.error.data })
      return body.result
    },
  }
  try {
    const k = 'kittora:session'
    const cur = JSON.parse(localStorage.getItem(k) ?? 'null') as { token?: string } | null
    if (!cur?.token) localStorage.setItem(k, JSON.stringify({ nimiqAddress: 'NQ00 DEVN ET00 0000 0000 0000 0000 0000 0000', token: 'devnet' }))
  } catch { /* storage blocked: sign-in screen shows instead */ }

  const bar = document.createElement('div')
  bar.setAttribute('role', 'note')
  bar.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:50;font:600 11px system-ui;background:#7c3aed;color:#fff;padding:3px 8px;border-radius:0 0 8px 8px;display:flex;gap:6px'
  bar.innerHTML = `DEVNET · member ${i + 1} ${account.slice(0, 6)}…` + members.map((_, j) => `<a href="?as=${j}" style="color:#fff;${j === i ? 'text-decoration:underline' : 'opacity:.7'}">${j + 1}</a>`).join('')
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(bar))
  if (document.body) document.body.appendChild(bar)
}

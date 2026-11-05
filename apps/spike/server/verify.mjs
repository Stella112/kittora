// THROWAWAY spike server (Gate 0). Plain node:http, port 8787. Vite proxies /api here.
// S1: verify Nimiq sign(). S4: recover EIP-712 signer. S5: relay meta-tx approve + vault deposit/withdraw.
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { createPublicClient, createWalletClient, http, recoverTypedDataAddress, parseAbi, encodeFunctionData } from 'viem'
import { polygon } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { verifyNimiqSignature } from './nimiq-verify.mjs'

// minimal .env loader (spike only)
const envPath = new URL('../.env', import.meta.url)
if (existsSync(envPath)) for (const l of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
const VAULT = process.env.SPIKE_VAULT
const rpc = http(process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com')
const pub = createPublicClient({ chain: polygon, transport: rpc })
const relayer = process.env.RELAYER_PRIVATE_KEY ? privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY) : null
const wallet = relayer ? createWalletClient({ account: relayer, chain: polygon, transport: rpc }) : null

const tokenAbi = parseAbi([
  'function executeMetaTransaction(address user, bytes functionSignature, bytes32 sigR, bytes32 sigS, uint8 sigV) payable returns (bytes)',
  'function getNonce(address user) view returns (uint256)',
  'function name() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
])
const vaultAbi = parseAbi([
  'function deposit(address owner, uint256 amount, uint256 deadline, bytes sig)',
  'function withdraw(address owner, uint256 amount, uint256 deadline, bytes sig)',
  'function nonces(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
])

const challenges = new Map() // nonce -> expiry (S1 replay protection)
const log = (...a) => console.log(new Date().toISOString(), ...a)

async function simulateAndSend(address, abi, functionName, args) {
  if (!wallet) throw new Error('RELAYER_PRIVATE_KEY not set')
  const { request } = await pub.simulateContract({ account: relayer, address, abi, functionName, args })
  const hash = await wallet.writeContract(request)
  log('sent', functionName, hash)
  const rcpt = await pub.waitForTransactionReceipt({ hash })
  if (rcpt.status !== 'success') throw new Error(`tx reverted: ${hash}`)
  return { hash, from: relayer.address, block: Number(rcpt.blockNumber) }
}

const routes = {
  'GET /api/health': async () => ({ ok: true, relayer: relayer?.address ?? null, vault: VAULT ?? null }),
  'GET /api/challenge': async () => {
    const nonce = crypto.randomUUID(); challenges.set(nonce, Date.now() + 5 * 60_000)
    return { message: `Kittora spike sign-in\nnonce: ${nonce}`, nonce }
  },
  'POST /api/s1': async ({ address, message, publicKey, signature, nonce }) => {
    const exp = challenges.get(nonce)
    if (!exp || exp < Date.now() || !message.includes(nonce)) throw new Error('unknown or expired challenge')
    challenges.delete(nonce)
    return { verified: true, address: verifyNimiqSignature({ message, publicKey, signature, expectedAddress: address }) }
  },
  'POST /api/s4': async ({ typedData, signature, address }) => {
    const recovered = await recoverTypedDataAddress({ ...typedData, signature })
    return { recovered, matches: recovered.toLowerCase() === address.toLowerCase() }
  },
  'GET /api/s5/state': async (_b, q) => {
    const u = q.get('user')
    const [name, nonce, bal, allowance, vbal, vnonce] = await Promise.all([
      pub.readContract({ address: USDT, abi: tokenAbi, functionName: 'name' }),
      pub.readContract({ address: USDT, abi: tokenAbi, functionName: 'getNonce', args: [u] }),
      pub.readContract({ address: USDT, abi: tokenAbi, functionName: 'balanceOf', args: [u] }),
      VAULT ? pub.readContract({ address: USDT, abi: tokenAbi, functionName: 'allowance', args: [u, VAULT] }) : 0n,
      VAULT ? pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'balanceOf', args: [u] }) : 0n,
      VAULT ? pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'nonces', args: [u] }) : 0n,
      ])
    const pol = await pub.getBalance({ address: u })
    return { tokenName: name, tokenNonce: String(nonce), usdt: String(bal), allowance: String(allowance),
      vaultBalance: String(vbal), vaultNonce: String(vnonce), userPol: String(pol), vault: VAULT }
  },
  'POST /api/s5/approve': async ({ user, functionSignature, signature }) => {
    // only allow approve(VAULT, amount) on USDT
    const expectPrefix = encodeFunctionData({ abi: parseAbi(['function approve(address,uint256)']), functionName: 'approve', args: [VAULT, 0n] }).slice(0, 74)
    if (!functionSignature.toLowerCase().startsWith(expectPrefix.toLowerCase())) throw new Error('only approve(vault, x) allowed')
    const r = signature.slice(0, 66), s = '0x' + signature.slice(66, 130), v = parseInt(signature.slice(130, 132), 16)
    return simulateAndSend(USDT, tokenAbi, 'executeMetaTransaction', [user, functionSignature, r, s, v])
  },
  'POST /api/s5/vault': async ({ action, owner, amount, deadline, signature }) => {
    if (!['deposit', 'withdraw'].includes(action)) throw new Error('bad action')
    return simulateAndSend(VAULT, vaultAbi, action, [owner, BigInt(amount), BigInt(deadline), signature])
  },
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const h = routes[`${req.method} ${url.pathname}`]
  res.setHeader('content-type', 'application/json')
  if (!h) { res.statusCode = 404; return res.end('{"error":"not found"}') }
  let body = ''
  for await (const c of req) body += c
  try {
    const out = await h(body ? JSON.parse(body) : {}, url.searchParams)
    log(url.pathname, 'ok'); res.end(JSON.stringify(out))
  } catch (e) {
    log(url.pathname, 'ERR', e.shortMessage || e.message)
    res.statusCode = 400; res.end(JSON.stringify({ error: e.shortMessage || e.message }))
  }
}).listen(8787, () => log('spike server :8787, relayer', relayer?.address ?? '(none)', 'vault', VAULT ?? '(none)'))

// TEST HARNESS: anvil fork of Polygon at a pinned block, contracts deployed with script/Deploy.s.sol.
// Keys below are anvil's public, well-known dev keys (test values only).
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { createPublicClient, createTestClient, http, parseAbi, type Address, type Hex } from 'viem'
import { polygon } from 'viem/chains'
import { fileURLToPath } from 'node:url'

export const ANVIL_KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex, // anvil #0
  attester: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex, // anvil #1
  relayer: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex, // anvil #2
}
export const USDT: Address = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
const AUSDT_WHALE: Address = '0x6ab707Aca953eDAeFBc4fD23bA73294241490620' // aUSDT holds the underlying

export async function startFork(port: number) {
  const proc: ChildProcess = spawn('anvil', ['--fork-url', process.env.POLYGON_ARCHIVE_RPC ?? 'https://polygon.drpc.org', '--fork-block-number', '96810000', '--port', String(port), '--silent'], { stdio: 'ignore' })
  const url = `http://127.0.0.1:${port}`
  const pub = createPublicClient({ chain: polygon, transport: http(url, { timeout: 120_000 }) })
  for (let i = 0; i < 120; i++) {
    try {
      await pub.getBlockNumber()
      break
    } catch {
      await new Promise(r => setTimeout(r, 500))
    }
  }
  const contracts = fileURLToPath(new URL('../../../packages/contracts/', import.meta.url))
  const out = execFileSync('forge', ['script', 'script/Deploy.s.sol', '--rpc-url', url, '--private-key', ANVIL_KEYS.deployer, '--broadcast'], {
    cwd: contracts, env: { ...process.env, ATTESTER_ADDRESS: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', CLAIM_DELAY_SECONDS: '3600' }, encoding: 'utf8',
  })
  const vault = out.match(/PocketVault (0x[0-9a-fA-F]{40})/)![1] as Address
  const group = out.match(/GroupKitty\s+(0x[0-9a-fA-F]{40})/)![1] as Address
  const test = createTestClient({ chain: polygon, mode: 'anvil', transport: http(url, { timeout: 120_000 }) })
  return { proc, url, pub, test, vault, group }
}

export async function fundUsdt(f: Awaited<ReturnType<typeof startFork>>, to: Address, amount: bigint) {
  await f.test.impersonateAccount({ address: AUSDT_WHALE })
  await f.test.setBalance({ address: AUSDT_WHALE, value: 10n ** 18n })
  const { createWalletClient } = await import('viem')
  const w = createWalletClient({ chain: polygon, transport: http(f.url, { timeout: 120_000 }), account: AUSDT_WHALE })
  const hash = await w.writeContract({ address: USDT, abi: parseAbi(['function transfer(address,uint256) returns (bool)']), functionName: 'transfer', args: [to, amount] })
  await f.pub.waitForTransactionReceipt({ hash })
  await f.test.stopImpersonatingAccount({ address: AUSDT_WHALE })
}

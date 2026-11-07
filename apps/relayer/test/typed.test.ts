// Every EIP-712 type the app signs must match the contract's typehash string exactly (names, types, order).
// Reads the Solidity sources, so a mismatch fails here instead of as "bad signature" on a phone.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { vaultTypes, groupTypes } from '@kittora/core'

const src = (f: string) => readFileSync(fileURLToPath(new URL(`../../../packages/contracts/src/${f}`, import.meta.url)), 'utf8')

function typehashStrings(sol: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of sol.matchAll(/keccak256\(\s*"([A-Za-z]+)\(([^"]*)\)"\s*\)/g)) out.set(m[1], `${m[1]}(${m[2]})`)
  return out
}

const encodeType = (primary: string, fields: readonly { name: string, type: string }[]) =>
  `${primary}(${fields.map(f => `${f.type} ${f.name}`).join(',')})`

describe('EIP-712 types match the contracts', () => {
  const cases: [string, Record<string, readonly { name: string, type: string }[]>, string][] = [
    ['PocketVault.sol', vaultTypes, 'vault'],
    ['GroupKitty.sol', groupTypes, 'group'],
  ]
  for (const [file, types, label] of cases) {
    it(`${label}: every signed type has an identical typehash in ${file}`, () => {
      const onChain = typehashStrings(src(file))
      for (const [primary, fields] of Object.entries(types)) {
        expect(onChain.get(primary), `${primary} missing in ${file}`).toBeDefined()
        expect(encodeType(primary, fields)).toBe(onChain.get(primary))
      }
    })
  }

  it('the group contract has no typehash the app cannot sign', () => {
    const onChain = [...typehashStrings(src('GroupKitty.sol')).keys()]
    expect(onChain.sort()).toEqual(Object.keys(groupTypes).sort())
  })
})

import { describe as suite, it, expect } from 'vitest'
import { buildFeed, describe, fmtUsdt } from './activityFeed.ts'

const ME = '0x00000000000000000000000000000000000000aa'
const OTHER = '0x00000000000000000000000000000000000000bb'
const H1 = `0x${'1'.repeat(64)}`
const H2 = `0x${'2'.repeat(64)}`
const H3 = `0x${'3'.repeat(64)}`

suite('activity labels', () => {
  it('formats USDT from decimal strings', () => {
    expect(fmtUsdt('8800000')).toBe('8.80')
    expect(fmtUsdt('1234567891')).toBe('1,234.56')
  })

  it('speaks from the viewer\'s side', () => {
    expect(describe({ event: 'LoanRequested', args: { loanId: '3', borrower: ME, principal: '8000000' } }, ME).text).toBe('Asked for a 8.00 USDT loan (#3)')
    expect(describe({ event: 'LoanRequested', args: { loanId: '3', borrower: OTHER, principal: '8000000' } }, ME).text).toBe('Asked to guarantee loan #3 (8.00 USDT)')
    expect(describe({ event: 'SharesBought', args: { groupId: '2', shares: '5', social: '200000', payer: ME } }, ME).text).toBe('Bought 5 shares in group #2 + 0.20 social fund')
    expect(describe({ event: 'SharesBought', args: { groupId: '2', shares: '1', social: '0', payer: OTHER } }, ME).text).toBe('Bought 1 share in group #2 (Autosave)')
    expect(describe({ event: 'LoanRepaid', args: { loanId: '3', payer: ME, amount: '8800000', remaining: '0' } }, ME)).toEqual({ text: 'You repaid 8.80 USDT on loan #3 (fully repaid)', tone: 'good' })
    expect(describe({ event: 'LoanDefaulted', args: { loanId: '3', writtenOff: '5000000' } }, ME).tone).toBe('bad')
    expect(describe({ event: 'ShareOutClaimed', args: { groupId: '2', amount: '5366666', rolledIntoPocket: '0' } }, ME).text).toBe('Share-Out from group #2: 5.36 USDT to your wallet')
    expect(describe({ event: 'ShareOutClaimed', args: { groupId: '2', amount: '5366666', rolledIntoPocket: '4' } }, ME).text).toContain('into pocket #4')
  })
})

suite('feed merge', () => {
  it('one row per tx, chain wins over local, local-only rows kept, newest first', () => {
    const chain = [
      { contract: 'vault' as const, event: 'Deposited', args: { pocketId: '1', amount: '5000000' }, hash: H1, block: '10', logIndex: 1, ts: 1000 },
      { contract: 'vault' as const, event: 'PocketOpened', args: { pocketId: '1', kind: '0' }, hash: H1, block: '10', logIndex: 0, ts: 1000 },
    ]
    const local = [
      { label: 'Open your Flex', chain: 'polygon' as const, hash: H1, status: 'pending' as const, ts: 999_000 },
      { label: 'Stake NIM', chain: 'nimiq' as const, hash: H2, status: 'confirmed' as const, ts: 2_000_000 },
      { label: 'Deposit', chain: 'polygon' as const, hash: H3, status: 'failed' as const, ts: 500_000 },
    ]
    const f = buildFeed(chain, local, ME)
    expect(f.map(r => r.hash)).toEqual([H2, H1, H3])
    const opened = f[1]
    expect(opened.status).toBe('confirmed')
    expect(opened.labels).toEqual(['Opened Flex pocket #1', 'Saved 5.00 USDT in pocket #1'])
    expect(opened.tone).toBe('good')
    expect(f[2]).toMatchObject({ status: 'failed', tone: 'bad' })
  })
})

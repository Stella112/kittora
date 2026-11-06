import { describe, it, expect } from 'vitest'
import { loanCheck, parseGroupRef, shareOutEstimate, valueOf, type GroupDetail } from './groupMath.ts'

const p = { sharePrice: 1_000_000n, socialFundPerMeeting: 200_000n, meetingInterval: 3600n, cycleEnd: 0n, gracePeriod: 600n, interestBps: 1000, maxLoanMultipleBps: 30000, maxSharesPerMeeting: 5, approvalsRequired: 2, maxMembers: 10 }

describe('group math mirrors GroupKitty', () => {
  it('values shares at sharePrice before any shares exist, then at pool value per share', () => {
    expect(valueOf({ totalShares: 0n, cash: 0n, outstanding: 0n, p }, 3n)).toBe(3_000_000n)
    // DECISIONS.md worked example after repayment: cash 52, S 50 → 1.04 per share
    expect(valueOf({ totalShares: 50n, cash: 52_000_000n, outstanding: 0n, p }, 10n)).toBe(10_400_000n)
  })

  it('loan limit: own value × multiple and own value + pledges (worked example: Bob 20 with Carol pledging 10)', () => {
    const g = { totalShares: 50n, cash: 50_000_000n, outstanding: 0n, p }
    const bob = { shares: 10n, pledged: 0n }
    const alone = loanCheck(g, bob, 20_000_000n, [])
    expect(alone.ownValue).toBe(10_000_000n)
    expect(alone.multipleCap).toBe(30_000_000n)
    expect(alone.needCover).toBe(10_000_000n)
    const withCarol = loanCheck(g, bob, 20_000_000n, [10n])
    expect(withCarol.needCover).toBe(0n)
    expect(withCarol.overMultiple).toBe(false)
    expect(loanCheck(g, bob, 31_000_000n, [10n, 10n]).overMultiple).toBe(true)
    // pledged shares do not count toward one's own limit
    expect(loanCheck(g, { shares: 10n, pledged: 4n }, 0n, []).ownValue).toBe(6_000_000n)
  })

  it('Share-Out estimate: cash × shares / total + social / members (worked example 10.8)', () => {
    const g = { totalShares: 50n, cash: 52_000_000n, socialFund: 2_000_000n, memberCount: 5 } as GroupDetail
    expect(shareOutEstimate(g, 10n)).toBe(10_800_000n)
  })
})

describe('invite parsing', () => {
  it('accepts a number, a Kittora link, or a Nimiq Pay universal link', () => {
    expect(parseGroupRef(' 3 ')).toBe(3n)
    expect(parseGroupRef('https://kittora.example/groups/12?name=Market')).toBe(12n)
    expect(parseGroupRef('https://nimpay.app/miniapps/open/kittora.example/groups/7?name=x')).toBe(7n)
    expect(parseGroupRef('0')).toBeNull()
    expect(parseGroupRef('groups/abc')).toBeNull()
  })
})

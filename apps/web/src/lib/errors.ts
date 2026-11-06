// One error vocabulary for the whole app (brief §4.1 item 5). Every kind has plain words and a retry path.
export type ErrorKind =
  | 'not_in_nimiq_pay'
  | 'rejected'
  | 'wrong_network'
  | 'no_usdt'
  | 'relay_failed'
  | 'pending'
  | 'rpc_down'
  | 'not_deployed'
  | 'blocked'
  | 'unknown'

export interface AppError {
  kind: ErrorKind
  title: string
  message: string
  retryLabel: string
  detail?: string
}

const COPY: Record<ErrorKind, Omit<AppError, 'kind' | 'detail'>> = {
  not_in_nimiq_pay: { title: 'Open Kittora in Nimiq Pay', message: 'Kittora runs inside the Nimiq Pay app. Open it from Mini Apps there.', retryLabel: 'Try again' },
  rejected: { title: 'You cancelled the request', message: 'Nothing was signed and nothing moved. You can try again whenever you are ready.', retryLabel: 'Try again' },
  wrong_network: { title: 'Wrong network', message: 'Kittora uses Polygon for dollars. Approve the switch to Polygon and try again.', retryLabel: 'Switch and retry' },
  no_usdt: { title: 'Not enough USDT', message: 'Your Polygon USDT balance is too low for this. Add USDT in Nimiq Pay, then try again.', retryLabel: 'Check again' },
  relay_failed: { title: 'We could not send that', message: 'Our relay could not submit your request. Your funds have not moved. Please try again.', retryLabel: 'Retry' },
  pending: { title: 'Still confirming', message: 'Your transaction was sent and is waiting for the network. It is not complete yet.', retryLabel: 'Check status' },
  rpc_down: { title: 'Network is not responding', message: 'We could not reach the blockchain just now. Your funds are safe. Check your connection and retry.', retryLabel: 'Retry' },
  not_deployed: { title: 'Not live yet', message: 'Kittora contracts are not deployed on this network yet.', retryLabel: 'Reload' },
  blocked: { title: 'Not allowed yet', message: 'The contract rules do not allow this right now.', retryLabel: 'Back' },
  unknown: { title: 'Something went wrong', message: 'Nothing was charged. Please try again.', retryLabel: 'Retry' },
}

/** Contract custom errors that mean "the rules block this" → readable words. */
const RULES: Record<string, string> = {
  Locked: 'This SafeLock is still locked. You can withdraw on its unlock date.',
  CapExceeded: 'This is above the pilot limit (25 USDT per deposit, 100 USDT per person).',
  PoolCapExceeded: 'This group has reached its 500 USDT pilot limit.',
  MeetingLimit: 'You have bought the most shares allowed for this meeting.',
  LoanLimit: 'This loan is above your limit. Add a guarantor or ask for less.',
  HasActiveLoan: 'You already have an open loan in this group.',
  CycleEnded: 'This group cycle has ended.',
  CycleNotEnded: 'Share-Out opens when the cycle ends.',
  LoansOutstanding: 'Share-Out opens once every loan is repaid or settled.',
  NotReady: 'This loan still needs approvals before it can be paid out.',
  AlreadyApproved: 'You already approved this.',
  ClaimNotOpen: 'Your bond can be claimed after the lock date.',
}

export function makeError(kind: ErrorKind, detail?: string, message?: string): AppError {
  return { kind, ...COPY[kind], ...(message ? { message } : {}), detail }
}

export function classify(e: unknown): AppError {
  if (e && typeof e === 'object' && 'kind' in e && 'title' in e) return e as AppError
  const err = e as { code?: number | string, message?: string, error?: string, shortMessage?: string }
  const text = `${err?.error ?? ''} ${err?.shortMessage ?? ''} ${err?.message ?? ''}`.trim()
  const code = err?.code

  if (code === 4001 || /user rejected|user denied|rejected the request|cancel|permission denied/i.test(text)) return makeError('rejected', text)
  if (code === 4902 || /chain.*(mismatch|doesn't match|unsupported)|wrong network|switch.*chain/i.test(text)) return makeError('wrong_network', text)
  if (/ERC20InsufficientBalance|exceeds balance|insufficient balance|transfer amount exceeds/i.test(text)) return makeError('no_usdt', text)
  const rule = Object.keys(RULES).find(r => new RegExp(`\\b${r}\\b`).test(text))
  if (rule) return makeError('blocked', text, RULES[rule])
  if (err?.error === 'pending' || /timed? ?out waiting|still pending/i.test(text)) return makeError('pending', text)
  if (err?.error === 'rpc_down' || /failed to fetch|network ?error|fetch failed|ECONN|load failed|503/i.test(text)) return makeError('rpc_down', text)
  if (err?.error && ['rate_limited', 'send_failed', 'gas_cap', 'internal', 'simulation_failed', 'replayed', 'bad_nonce', 'expired', 'bad_signature'].includes(err.error)) {
    const msg = err.error === 'rate_limited' ? 'Too many requests in the last hour. Please wait a little and try again.'
      : err.error === 'expired' ? 'That request took too long and expired. Please sign it again.'
        : undefined
    return makeError('relay_failed', text, msg)
  }
  if (/nimiq pay not detected|no nimiq provider|not_in_nimiq_pay/i.test(text)) return makeError('not_in_nimiq_pay', text)
  return makeError('unknown', text)
}

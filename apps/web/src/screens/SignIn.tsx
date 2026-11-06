import { BRAND } from '@kittora/core'
import { useSession } from '../state/session.tsx'
import { Button, Card, ErrorPanel, TestnetBadge } from '../components/ui.tsx'

export function SignIn() {
  const { signIn, signingIn, error } = useSession()
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <p className="text-3xl font-extrabold text-brand-strong">{BRAND.name}</p>
        <TestnetBadge />
      </div>
      <Card>
        <h1 className="text-2xl font-bold leading-tight">Save alone. Grow together.</h1>
        <ul className="mt-4 space-y-3 text-[15px]">
          <li><b>Borrow from your group</b> with friends as guarantors. Interest goes back to everyone.</li>
          <li><b>Own shares</b> in your group pot and get your savings plus profit at Share-Out.</li>
          <li><b>Earn on dollars</b>: USDT pockets earn a variable Aave rate.</li>
        </ul>
      </Card>
      {error && <ErrorPanel error={error} />}
      <div>
        <Button onClick={signIn} disabled={signingIn}>{signingIn ? 'Waiting for Nimiq Pay…' : 'Sign in with Nimiq'}</Button>
        <p className="mt-3 text-center text-sm text-muted">You sign a message to prove you own your address. It is free and moves no funds.</p>
      </div>
    </main>
  )
}

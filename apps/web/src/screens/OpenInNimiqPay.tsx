import { BRAND } from '@kittora/core'
import { openInNimiqPayLinks } from '../config.ts'
import { Button, Card } from '../components/ui.tsx'

/** Shown outside Nimiq Pay instead of crashing (Gate 3). */
export function OpenInNimiqPay({ onRetry }: { onRetry: () => void }) {
  const links = openInNimiqPayLinks()
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="text-3xl font-extrabold text-brand-strong">{BRAND.name}</p>
        <p className="mt-1 text-lg text-muted">{BRAND.tagline}</p>
      </div>
      <Card>
        <h1 className="text-xl font-bold">Open in Nimiq Pay</h1>
        <p className="mt-2 text-muted">
          {BRAND.name} is a Nimiq Pay mini app. Your savings, group shares and loans are signed with your Nimiq Pay wallet, so it only runs inside the app.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <a href={links.universal} className="flex min-h-12 items-center justify-center rounded-2xl bg-brand px-5 font-semibold text-white">Open in Nimiq Pay</a>
          <a href={links.scheme} className="flex min-h-12 items-center justify-center rounded-2xl bg-brand-soft px-5 font-semibold text-brand-strong">I have Nimiq Pay installed</a>
          <Button variant="ghost" onClick={onRetry}>I am already in Nimiq Pay, check again</Button>
        </div>
      </Card>
      <p className="text-center text-sm text-muted">No Nimiq Pay yet? Get it from nimpay.app, then come back.</p>
    </main>
  )
}

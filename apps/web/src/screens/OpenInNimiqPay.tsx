import qrcode from 'qrcode-generator'
import { openInNimiqPayLinks } from '../config.ts'
import { Button } from '../components/ui.tsx'
import { LogoMark } from '../components/Logo.tsx'

/** QR as an SVG path (crisp at any size). */
function QR({ text }: { text: string }) {
  const q = qrcode(0, 'M')
  q.addData(text)
  q.make()
  const n = q.getModuleCount()
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} className="h-auto w-full" role="img" aria-label="QR code to open Kittora in Nimiq Pay">
      <rect x="-2" y="-2" width={n + 4} height={n + 4} fill="#ffffff" />
      <path d={d} fill="#0a4f3d" shapeRendering="crispEdges" />
    </svg>
  )
}

const FEATURES = [
  ['Pockets that earn', 'Flex, Target and SafeLock in USDT, earning the Aave rate.', 'bg-gold'],
  ['Savings groups', 'Shares each meeting, loans with guarantors, a social fund.', 'bg-pink'],
  ['Share-Out', 'Savings plus everyone\'s interest, back to each member.', 'bg-mint'],
  ['No gas fees', 'You sign in Nimiq Pay; Kittora pays the network fee.', 'bg-brand-soft'],
] as const

/** Shown outside Nimiq Pay instead of crashing (Gate 3). */
export function OpenInNimiqPay({ onRetry }: { onRetry: () => void }) {
  const links = openInNimiqPayLinks()
  return (
    <main className="mx-auto min-h-dvh max-w-[1040px] px-4 py-8 md:py-14">
      {/* brand banner, in the style of the Kittora header */}
      <section className="relative overflow-hidden rounded-[32px] px-6 py-8 md:px-10 md:py-12" style={{ background: '#fbf6ec' }}>
        <span aria-hidden className="absolute -right-10 -top-10 h-32 w-32 rounded-full border-[5px] border-[#a9dccb] md:right-10 md:top-1/2 md:h-64 md:w-64 md:-translate-y-1/2" />
        <span aria-hidden className="absolute -right-2 -top-2 h-16 w-16 rounded-full bg-[#f2b134] md:right-[6.5rem] md:top-1/2 md:h-36 md:w-36 md:-translate-y-1/2" />
        <span aria-hidden className="absolute right-3 top-3 h-6 w-6 rounded-full bg-[#f8d78c] md:right-[9.25rem] md:top-1/2 md:h-12 md:w-12 md:-translate-y-1/2" />
        <span aria-hidden className="absolute bottom-4 right-6 h-4 w-4 rounded-full bg-[#f2b134] md:bottom-auto md:right-24 md:top-6" />
        <span aria-hidden className="absolute left-[55%] top-8 h-3 w-3 rounded-full bg-[#f6b9cf]" />
        <span aria-hidden className="absolute bottom-6 left-[60%] hidden h-2 w-24 -rotate-[35deg] rounded-full bg-[#f6b9cf] md:block" />
        <span aria-hidden className="absolute bottom-10 left-[66%] hidden h-2 w-20 rotate-[35deg] rounded-full bg-[#a9dccb] md:block" />
        <div className="relative max-w-[560px]">
          <div className="flex items-center gap-3">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-white shadow-[0_4px_14px_rgba(16,35,29,0.12)] md:h-20 md:w-20"><LogoMark size={44} /></span>
            <span className="text-[44px] font-black lowercase leading-none tracking-tight text-[#0e6b52] md:text-[72px]">kittora</span>
          </div>
          <p className="mt-3 text-xl font-extrabold text-[#e8829f] md:text-2xl">save alone, grow together.</p>
          <p className="mt-1 text-sm font-bold text-[#10231d] md:text-base">Savings accounts + savings groups, inside Nimiq Pay</p>
        </div>
      </section>

      <div className="mt-6 grid gap-6 md:grid-cols-[1.2fr_1fr]">
        <section>
          <h1 className="text-2xl md:text-3xl">Kittora lives inside Nimiq Pay</h1>
          <p className="mt-2 text-muted">Your savings, group shares and loans are signed with your Nimiq Pay wallet, so the app opens there. Your dollars stay on Polygon in your own wallet until you sign.</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {FEATURES.map(([t, d, c]) => (
              <li key={t} className="rounded-[22px] bg-surface p-4 ring-1 ring-line">
                <span aria-hidden className={`block h-3 w-3 rounded-full ${c}`} />
                <p className="mt-2 font-extrabold text-ink">{t}</p>
                <p className="text-sm text-muted">{d}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="order-first rounded-[28px] bg-surface p-6 shadow-[0_10px_30px_-12px_rgba(16,35,29,0.25)] ring-1 ring-line md:order-none">
          <h2 className="text-xl font-black"><span className="md:hidden">Open Kittora</span><span className="hidden md:inline">Open it on your phone</span></h2>
          <p className="mt-1 text-sm text-muted"><span className="md:hidden">Tap to open Kittora in Nimiq Pay.</span><span className="hidden md:inline">Scan with your phone camera. It opens Kittora in Nimiq Pay.</span></p>
          <div className="mx-auto mt-4 hidden w-56 overflow-hidden rounded-[20px] p-2 ring-1 ring-line md:block" style={{ background: '#ffffff' }}><QR text={links.universal} /></div>
          <div className="mt-5 flex flex-col gap-3">
            <a href={links.universal} className="flex min-h-12 items-center justify-center rounded-full bg-brand px-5 font-extrabold text-surface">Open in Nimiq Pay</a>
            <a href={links.scheme} className="flex min-h-12 items-center justify-center rounded-full bg-brand-soft px-5 font-extrabold text-brand-strong">I have Nimiq Pay installed</a>
            <Button variant="ghost" onClick={onRetry}>I am already in Nimiq Pay, check again</Button>
          </div>
          <p className="mt-3 text-center text-xs text-muted">No Nimiq Pay yet? Get it from <a className="font-bold text-brand-strong underline" href="https://nimpay.app" target="_blank" rel="noreferrer">nimpay.app</a>, then come back.</p>
        </section>
      </div>
    </main>
  )
}

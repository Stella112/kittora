import { NavLink, Outlet } from 'react-router'
import { BRAND } from '@kittora/core'
import { TestnetBadge } from './ui.tsx'

const tabs = [
  { to: '/', label: 'Home', icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/save', label: 'Save', icon: 'M12 3v18M5 10l7-7 7 7' },
  { to: '/groups', label: 'Groups', icon: 'M7 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm10 0a4 4 0 1 0 0-8M2 21v-2a5 5 0 0 1 5-5h0a5 5 0 0 1 5 5v2m4-7a5 5 0 0 1 6 5v2' },
  { to: '/activity', label: 'Activity', icon: 'M4 6h16M4 12h16M4 18h10' },
]

export function Layout() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
      <header className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <span className="text-lg font-extrabold text-brand-strong">{BRAND.name}</span>
        <TestnetBadge />
      </header>
      <main className="flex-1 px-4 pb-28">
        <Outlet />
      </main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-[480px] grid-cols-4">
          {tabs.map(t => (
            <li key={t.to}>
              <NavLink to={t.to} end={t.to === '/'} className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium ${isActive ? 'text-brand-strong' : 'text-muted'}`}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={t.icon} /></svg>
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

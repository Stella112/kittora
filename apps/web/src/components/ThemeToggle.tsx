// Auto (follow the phone) → Light → Dark. Stored per device; storage may be blocked, then it just follows the phone.
import { useState } from 'react'

export type Theme = 'auto' | 'light' | 'dark'
const KEY = 'kittora:theme'

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
}

const ICON: Record<Theme, string> = {
  auto: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  light: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  dark: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
}
const LABEL: Record<Theme, string> = { auto: 'Theme: follows your phone', light: 'Theme: light', dark: 'Theme: dark' }
const NEXT: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' }

export function ThemeToggle() {
  const [t, setT] = useState<Theme>(readTheme)
  function cycle() {
    const n = NEXT[t]
    setT(n)
    applyTheme(n)
    try { if (n === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, n) } catch { /* not saved */ }
  }
  return (
    <button type="button" onClick={cycle} aria-label={`${LABEL[t]}. Tap to change`} title={LABEL[t]}
      className="flex h-10 items-center gap-1.5 rounded-full bg-surface px-3 text-xs font-extrabold text-ink ring-1 ring-line">
      <svg viewBox="0 0 24 24" width="18" height="18" fill={t === 'auto' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON[t]} /></svg>
      {t === 'auto' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
    </button>
  )
}

// A1.1: the fixed list of 8 group covers (brand colours: emerald, gold, baby pink, cream). No image uploads.
// coverId on-chain is an index into this list; unknown ids fall back to cover 0.
export interface Cover { id: number, name: string, from: string, to: string, ink: string, sub: string }

export const COVERS: readonly Cover[] = [
  { id: 0, name: 'Emerald', from: '#065f46', to: '#10b981', ink: '#ffffff', sub: 'rgba(255,255,255,0.88)' },
  { id: 1, name: 'Gold', from: '#a16207', to: '#eab308', ink: '#ffffff', sub: 'rgba(255,255,255,0.9)' },
  { id: 2, name: 'Baby pink', from: '#f9a8d4', to: '#fce7f3', ink: '#500724', sub: 'rgba(80,7,36,0.78)' },
  { id: 3, name: 'Cream', from: '#f3e3c3', to: '#fffaf0', ink: '#3b2a12', sub: 'rgba(59,42,18,0.75)' },
  { id: 4, name: 'Emerald & gold', from: '#065f46', to: '#ca8a04', ink: '#ffffff', sub: 'rgba(255,255,255,0.88)' },
  { id: 5, name: 'Gold & pink', from: '#ca8a04', to: '#f472b6', ink: '#ffffff', sub: 'rgba(255,255,255,0.9)' },
  { id: 6, name: 'Cream & emerald', from: '#fff7e6', to: '#6ee7b7', ink: '#064e3b', sub: 'rgba(6,78,59,0.78)' },
  { id: 7, name: 'Night emerald', from: '#022c22', to: '#047857', ink: '#ffffff', sub: 'rgba(255,255,255,0.85)' },
]

export const cover = (id: number | undefined | null): Cover => COVERS[id ?? 0] ?? COVERS[0]

export const coverStyle = (id: number | undefined | null) => {
  const c = cover(id)
  return { background: `linear-gradient(135deg, ${c.from}, ${c.to})`, color: c.ink }
}

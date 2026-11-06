// Local copy of this viewer's own submissions, so pending items show immediately. Activity (Phase 5) merges this
// with on-chain events, which stay the source of truth.
import { store } from './storage.ts'

export interface ActivityItem { label: string, chain: 'polygon' | 'nimiq', hash: string, status: 'pending' | 'confirmed' | 'failed', ts: number }

export function logActivity(owner: string, item: Omit<ActivityItem, 'ts'>) {
  const key = `activity:${owner.toLowerCase()}`
  const list = store.get<ActivityItem[]>(key) ?? []
  const i = list.findIndex(x => x.hash === item.hash)
  const next = { ...item, ts: Date.now() }
  if (i >= 0) list[i] = { ...list[i], ...next }
  else list.unshift(next)
  store.set(key, list.slice(0, 200))
}

export function readActivity(owner: string): ActivityItem[] {
  return store.get<ActivityItem[]>(`activity:${owner.toLowerCase()}`) ?? []
}

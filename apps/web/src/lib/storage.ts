// Per-viewer conveniences only (session token, disclosure acceptance). Every access is guarded: storage can be
// missing in private mode or previews, and the app must still work (it just asks again).
export const store = {
  get<T>(key: string): T | null {
    try {
      const v = localStorage.getItem(`kittora:${key}`)
      return v ? (JSON.parse(v) as T) : null
    } catch {
      return null
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`kittora:${key}`, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(`kittora:${key}`)
    } catch {
      /* ignore */
    }
  },
}

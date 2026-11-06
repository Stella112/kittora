import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Address } from 'viem'
import { nimiqProvider, unwrap, hostInjected } from '../lib/nimiq.ts'
import { connectEvm, ethereum } from '../lib/evm.ts'
import { relayer } from '../lib/relayer.ts'
import { store } from '../lib/storage.ts'
import { classify, type AppError } from '../lib/errors.ts'

type HostState = 'detecting' | 'in_nimiq_pay' | 'outside'

interface Session {
  host: HostState
  nimiqAddress: string | null
  evmAddress: Address | null
  token: string | null
  signingIn: boolean
  error: AppError | null
  signIn: () => Promise<void>
  connect: () => Promise<Address | null>
  signOut: () => void
  retryDetect: () => void
}

const Ctx = createContext<Session | null>(null)

interface Saved { nimiqAddress: string, token: string }

export function SessionProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HostState>('detecting')
  const [saved, setSaved] = useState<Saved | null>(() => store.get<Saved>('session'))
  const [evmAddress, setEvm] = useState<Address | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setHost('detecting')
    nimiqProvider()
      .then(() => live && setHost('in_nimiq_pay'))
      .catch(() => live && setHost(hostInjected() ? 'in_nimiq_pay' : 'outside'))
    return () => { live = false }
  }, [attempt])

  const connect = useCallback(async () => {
    try {
      const a = await connectEvm()
      setEvm(a)
      return a
    } catch (e) {
      setError(classify(e))
      return null
    }
  }, [])

  // Re-attach the EVM account silently if the host already granted it.
  useEffect(() => {
    if (host !== 'in_nimiq_pay' || !saved || evmAddress) return
    const eth = ethereum()
    eth?.request({ method: 'eth_accounts' }).then((a) => {
      const list = a as Address[]
      if (list?.[0]) setEvm(list[0])
    }).catch(() => undefined)
  }, [host, saved, evmAddress])

  const signIn = useCallback(async () => {
    setSigningIn(true)
    setError(null)
    try {
      const p = await nimiqProvider()
      const accounts = unwrap(await p.listAccounts())
      const address = accounts[0]
      if (!address) throw new Error('No Nimiq account was shared')
      const ch = await relayer.challenge()
      const sig = unwrap(await p.sign(ch.message))
      const { token, nimiqAddress } = await relayer.verify({ ...ch, address, publicKey: sig.publicKey, signature: sig.signature })
      const s = { nimiqAddress, token }
      store.set('session', s)
      setSaved(s)
      await connect()
    } catch (e) {
      setError(classify(e))
    } finally {
      setSigningIn(false)
    }
  }, [connect])

  const signOut = useCallback(() => {
    store.remove('session')
    setSaved(null)
    setEvm(null)
  }, [])

  const value = useMemo<Session>(() => ({
    host, nimiqAddress: saved?.nimiqAddress ?? null, token: saved?.token ?? null, evmAddress, signingIn, error,
    signIn, connect, signOut, retryDetect: () => setAttempt(a => a + 1),
  }), [host, saved, evmAddress, signingIn, error, signIn, connect, signOut])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useSession outside SessionProvider')
  return s
}

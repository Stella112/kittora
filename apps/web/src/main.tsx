import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { SessionProvider, useSession } from './state/session.tsx'
import { Layout } from './components/Layout.tsx'
import { Spinner } from './components/ui.tsx'
import { OpenInNimiqPay } from './screens/OpenInNimiqPay.tsx'
import { SignIn } from './screens/SignIn.tsx'
import { Home } from './screens/Home.tsx'
import { Disclosure } from './screens/Disclosure.tsx'
import { Groups, Activity } from './screens/Placeholders.tsx'
import { Save } from './screens/save/Save.tsx'
import { NewPocket } from './screens/save/NewPocket.tsx'
import { Pocket } from './screens/save/Pocket.tsx'
import { NimLock } from './screens/save/NimLock.tsx'

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/disclosure', element: <Disclosure /> },
      { path: '/save', element: <Save /> },
      { path: '/save/new/:kind', element: <NewPocket /> },
      { path: '/save/pocket/:id', element: <Pocket /> },
      { path: '/save/nim', element: <NimLock /> },
      { path: '/groups', element: <Groups /> },
      { path: '/activity', element: <Activity /> },
      { path: '*', element: <Home /> },
    ],
  },
])

function Gate() {
  const s = useSession()
  if (s.host === 'detecting') {
    return <div className="flex min-h-dvh items-center justify-center"><Spinner label="Opening Kittora…" /></div>
  }
  if (s.host === 'outside') return <OpenInNimiqPay onRetry={s.retryDetect} />
  if (!s.token) return <SignIn />
  return <RouterProvider router={router} />
}

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
)

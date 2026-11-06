import type { ReactNode } from 'react'
import type { Address } from 'viem'
import { useSession } from '../state/session.tsx'
import { contractsDeployed } from '../config.ts'
import { makeError } from '../lib/errors.ts'
import { Button, Card, ErrorPanel } from './ui.tsx'

/** Renders children with the connected Polygon address, or a connect / not-deployed state. */
export function RequireEvm({ children }: { children: (evm: Address) => ReactNode }) {
  const { evmAddress, connect, error } = useSession()
  if (!contractsDeployed()) return <ErrorPanel error={makeError('not_deployed')} />
  if (!evmAddress) {
    return (
      <Card className="space-y-3">
        <p className="font-semibold">Connect your Polygon account</p>
        <p className="text-sm text-muted">Your dollars stay in your own Nimiq Pay wallet until you sign. You never need POL: Kittora pays the fees.</p>
        {error && <ErrorPanel error={error} compact />}
        <Button onClick={connect}>Connect</Button>
      </Card>
    )
  }
  return <>{children(evmAddress)}</>
}

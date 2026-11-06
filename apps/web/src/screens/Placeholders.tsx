// Phase 3 shell only: these tabs get their real flows in Phase 4 (Save) and Phase 5 (Groups, Activity).
import { Card } from '../components/ui.tsx'

function Soon({ title, body }: { title: string, body: string }) {
  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-2xl font-bold">{title}</h1>
      <Card><p className="text-muted">{body}</p></Card>
    </div>
  )
}

export const Groups = () => <Soon title="Groups" body="Create or join a Group Kitty, buy shares, borrow with guarantors and claim your Share-Out." />
export const Activity = () => <Soon title="Activity" body="Every action with its Polygonscan or Nimiq explorer link and stamp status will appear here." />

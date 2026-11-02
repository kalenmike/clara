import { Link } from 'react-router'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConnection } from '@/providers/connection-provider'

/** Renders nothing unless the home agent reports Clara management is on. */
export function ClaraInboxButton({ onNavigate }: { onNavigate?: () => void }) {
  const { relayStatus } = useConnection()
  if (!relayStatus?.agent?.management) return null

  return (
    <Button asChild variant="ghost" size="icon" className="size-11 md:size-8">
      <Link to="/clara" onClick={onNavigate} title="Clara inbox">
        <Inbox className="size-5 md:size-4" />
        <span className="sr-only">Clara inbox</span>
      </Link>
    </Button>
  )
}

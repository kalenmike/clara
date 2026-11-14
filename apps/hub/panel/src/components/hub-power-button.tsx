import { useState } from 'react'
import { Power } from 'lucide-react'
import { postPanel } from '../lib/panel-api.ts'

/**
 * The hub keeps its process and panel alive while external connections are
 * stopped. This control is shared by the Overview header and the Hub card in
 * Settings, so both places offer the same confirmed action.
 */
export function HubPowerButton({
  stopped,
  onChanged,
  onError,
}: {
  stopped: boolean
  onChanged: () => void
  onError?: (message: string | undefined) => void
}) {
  const [pending, setPending] = useState(false)

  const toggle = async () => {
    const next = !stopped
    if (
      next &&
      !window.confirm(
        'Take every external connection offline? The panel stays available so you can bring them back.'
      )
    ) {
      return
    }
    setPending(true)
    onError?.(undefined)
    try {
      await postPanel('/panel/api/v1/agent', { stopped: next })
      onChanged()
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={pending}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
        stopped ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
      }`}
    >
      <Power className="size-3.5" aria-hidden="true" />
      {pending
        ? stopped
          ? 'Going online…'
          : 'Going offline…'
        : stopped
          ? 'Go online'
          : 'Go offline'}
    </button>
  )
}

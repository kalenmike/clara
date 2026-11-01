import { useEffect, useRef } from 'react'
import { isTextEntryTarget } from '@/lib/keyboard'

type KeybindActions = {
  onNewSession?: () => void
  onSessions?: () => void
  onToggleInfo?: () => void
  onOpenGit?: () => void
  onToggleTerminal?: () => void
  onToggleMessages?: () => void
  onCompact?: () => void
  onCopyReply?: () => void
  onInterrupt?: () => void
  onOpenModels?: () => void
  onOpenAgents?: () => void
  onCycleAgent?: (direction: 1 | -1) => void
  onCycleVariant?: () => void
  onToggleTheme?: () => void
}

const LEADER_TIMEOUT = 2000

export function useKeybinds(actions: KeybindActions) {
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    let leader = false
    let timer: number | undefined

    const handler = (event: KeyboardEvent) => {
      const current = actionsRef.current
      const key = event.key.toLowerCase()
      const typing = isTextEntryTarget(event.target)

      // A leader armed outside a field must not swallow the first key typed
      // inside one.
      if (typing && leader) {
        leader = false
        window.clearTimeout(timer)
      }

      // In a text field ctrl+x is the browser's cut, not the leader.
      if (!typing && (event.ctrlKey || event.metaKey) && key === 'x') {
        event.preventDefault()
        leader = true
        window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          leader = false
        }, LEADER_TIMEOUT)
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.code === 'Period') {
        leader = false
        window.clearTimeout(timer)
        event.preventDefault()
        current.onCycleAgent?.(event.shiftKey ? -1 : 1)
        return
      }

      if (leader) {
        leader = false
        window.clearTimeout(timer)
        switch (key) {
          case 'n':
            event.preventDefault()
            current.onNewSession?.()
            return
          case 'l':
            event.preventDefault()
            current.onSessions?.()
            return
          case 'm':
            event.preventDefault()
            current.onOpenModels?.()
            return
          case 'a':
            event.preventDefault()
            current.onOpenAgents?.()
            return
          case 'c':
            event.preventDefault()
            current.onCompact?.()
            return
          case 's':
            event.preventDefault()
            current.onToggleInfo?.()
            return
          case 'g':
            event.preventDefault()
            current.onOpenGit?.()
            return
          case '`':
            event.preventDefault()
            current.onToggleTerminal?.()
            return
          case 'h':
            event.preventDefault()
            current.onToggleMessages?.()
            return
          case 't':
            event.preventDefault()
            current.onToggleTheme?.()
            return
          case 'y':
            event.preventDefault()
            current.onCopyReply?.()
            return
          default:
            return
        }
      }

      if (event.key === 'Escape') {
        current.onInterrupt?.()
        return
      }

      if ((event.ctrlKey || event.metaKey) && key === 't') {
        event.preventDefault()
        current.onCycleVariant?.()
        return
      }

      if (event.key === 'Tab' && document.activeElement === document.body) {
        event.preventDefault()
        current.onCycleAgent?.(event.shiftKey ? -1 : 1)
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      window.clearTimeout(timer)
    }
  }, [])
}

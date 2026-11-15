import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '../components/button'
import { cn } from '../lib/utils'

export function CopyButton({
  value,
  label = 'Copy',
  onError,
  variant = 'compact',
  className,
}: {
  value: string
  label?: string
  onError?: (message: string) => void
  variant?: 'compact' | 'block'
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), 2_000)
    return () => window.clearTimeout(timer)
  }, [state])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('error')
      onError?.('Could not copy to the clipboard')
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={variant === 'block' ? 'sm' : 'xs'}
      onClick={() => void copy()}
      className={cn(variant === 'block' && 'w-full', className)}
      aria-label={label}
    >
      {state === 'copied' ? (
        <Check className="size-3" aria-hidden="true" />
      ) : (
        <Copy className="size-3" aria-hidden="true" />
      )}
      {state === 'copied' ? 'Copied' : state === 'error' ? 'Failed' : label}
    </Button>
  )
}

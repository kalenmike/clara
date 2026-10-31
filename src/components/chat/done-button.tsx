import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotificationSettings } from '@/features/notifications/use-notification-settings'
import { playDoneSound } from '@/features/notifications/sounds'
import { cn } from '@/lib/utils'

const BURST_PARTICLES = [
  { x: -26, y: -20, delay: 0, size: 4 },
  { x: 0, y: -30, delay: 10, size: 3 },
  { x: 26, y: -18, delay: 0, size: 4 },
  { x: 34, y: 6, delay: 14, size: 3 },
  { x: 22, y: 24, delay: 4, size: 4 },
  { x: -4, y: 30, delay: 12, size: 3 },
  { x: -28, y: 20, delay: 2, size: 4 },
  { x: -34, y: -4, delay: 8, size: 3 },
] as const

const BURST_COLORS = ['bg-emerald-400', 'bg-lime-400', 'bg-teal-300', 'bg-emerald-300'] as const

export function DoneButton({
  empty,
  pending,
  onConfirm,
}: {
  empty: boolean
  pending: boolean
  onConfirm: () => void
}) {
  const { settings } = useNotificationSettings()
  const [burst, setBurst] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    []
  )

  const handleClick = () => {
    if (pending) return

    if (settings.uiSounds) playDoneSound(settings.volume)

    setBurst(false)
    window.requestAnimationFrame(() => setBurst(true))
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setBurst(false), 700)

    onConfirm()
  }

  return (
    <Button
      type="button"
      size="lg"
      onClick={handleClick}
      disabled={pending}
      aria-label={empty ? 'Delete empty session' : 'Mark session done and archive'}
      title={empty ? 'Delete empty session' : 'Mark done and archive'}
      className={cn(
        'group relative h-9 overflow-visible rounded-full bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500 px-4 font-semibold text-white shadow-lg shadow-emerald-500/25',
        'transition-all duration-200 hover:-translate-y-0.5 hover:from-emerald-400 hover:via-green-400 hover:to-teal-400 hover:shadow-xl hover:shadow-emerald-500/40',
        'active:translate-y-0 active:scale-95',
        'focus-visible:border-emerald-400 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
        burst &&
          'scale-105 from-emerald-400 via-green-400 to-teal-400 shadow-[0_0_0_6px_rgba(52,211,153,0.28)] motion-reduce:scale-100'
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
      >
        <span className="absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-white/30 blur-md transition-transform duration-700 ease-out group-hover:translate-x-[400%] motion-reduce:hidden" />
      </span>

      <span className="relative z-10 flex items-center gap-2">
        {pending && !burst ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Check
            className={cn(
              'size-4 transition-transform duration-300 motion-reduce:transition-none',
              burst && 'scale-125 motion-reduce:scale-100'
            )}
          />
        )}
        {burst ? 'Done!' : pending ? 'Finishing…' : 'Done'}
      </span>

      {burst && (
        <span aria-hidden className="pointer-events-none absolute inset-0">
          <span
            className="absolute inset-0 rounded-full border-2 border-emerald-300 motion-reduce:hidden"
            style={{ animation: 'clara-done-ring 600ms ease-out forwards' }}
          />
          {BURST_PARTICLES.map((particle, index) => (
            <span
              key={index}
              className={cn(
                'absolute top-1/2 left-1/2 rounded-full motion-reduce:hidden',
                BURST_COLORS[index % BURST_COLORS.length]
              )}
              style={
                {
                  '--burst-x': `${particle.x}px`,
                  '--burst-y': `${particle.y}px`,
                  width: particle.size,
                  height: particle.size,
                  animationName: 'clara-done-burst',
                  animationDuration: '650ms',
                  animationDelay: `${particle.delay}ms`,
                  animationTimingFunction: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
                  animationFillMode: 'forwards',
                } as CSSProperties
              }
            />
          ))}
        </span>
      )}
    </Button>
  )
}

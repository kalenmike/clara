import { useId, useState } from 'react'
import { RotateCcw, Type } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@clara/ui/components/card'
import { Input } from '@clara/ui/components/input'
import { Label } from '@clara/ui/components/label'
import { useSessionWording } from '@/features/sessions/use-wording'
import { MAX_SESSION_WORD_LENGTH } from '@/features/sessions/wording'

const PRESETS = ['Brief', 'Task', 'Session', 'Action', 'Run', 'Job'] as const

export function WordingCard() {
  const inputID = useId()
  const { singular, plural, lowerSingular, lowerPlural, setSingular, reset } = useSessionWording()
  const [value, setValue] = useState(singular)

  const apply = (next: string) => setValue(setSingular(next))

  const commit = () => {
    if (!value.trim()) {
      setValue(singular)
      return
    }
    setValue(setSingular(value))
  }

  const restore = () => setValue(reset())

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Type className="size-4" /> Session wording
        </CardTitle>
        <CardDescription>
          Clara calls each session a name of your choice. The default is Brief.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={inputID}>Singular name</Label>
          <div className="flex gap-2">
            <Input
              id={inputID}
              value={value}
              maxLength={MAX_SESSION_WORD_LENGTH}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                const next = event.target.value
                setValue(next)
                if (next.trim()) setSingular(next)
              }}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
            <Button type="button" variant="outline" size="sm" onClick={restore}>
              <RotateCcw className="size-4" /> Reset
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              type="button"
              size="xs"
              variant={singular === preset ? 'secondary' : 'outline'}
              onClick={() => apply(preset)}
            >
              {preset}
            </Button>
          ))}
        </div>

        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          New {lowerSingular} · Search {lowerPlural} · Untitled {lowerSingular}
        </div>

        <p className="text-[11px] text-muted-foreground">
          The plural is generated automatically: {singular} → {plural}. The harness still calls
          these sessions in its API.
        </p>
      </CardContent>
    </Card>
  )
}

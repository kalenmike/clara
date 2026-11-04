import { useState } from 'react'
import { Check, Copy, Home, RotateCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'

type ErrorScreenProps = {
  detail?: string
  stack?: string
  route?: string
}

/**
 * The last line of defense when the app crashes. It deliberately uses no
 * providers or app state so it can still render when those are the problem.
 */
export function ErrorScreen({ detail, stack, route }: ErrorScreenProps) {
  const dev = import.meta.env.DEV
  const [copied, setCopied] = useState(false)

  const copyDetails = async () => {
    const text = [
      detail,
      route ? `Route: ${route}` : undefined,
      stack ? `Stack:\n${stack}` : undefined,
    ]
      .filter((part): part is string => Boolean(part))
      .join('\n\n')

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied; the button simply stays unchanged.
    }
  }

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-background px-4 py-10 text-foreground">
      <Card role="alert" className="w-full max-w-xl">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <TriangleAlert className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Clara</p>
              <h1 className="font-heading text-lg leading-snug font-medium">
                {dev ? 'Something broke' : 'Something went wrong'}
              </h1>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {dev
              ? 'Clara hit an unexpected error. The details below are only shown in development.'
              : 'Clara hit an unexpected problem. Reload to try again.'}
          </p>
          {dev && detail && (
            <pre className="max-h-48 overflow-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-foreground">
              {detail}
            </pre>
          )}
          {dev && (stack || route) && (
            <details className="rounded-lg border bg-muted/40">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground transition-colors select-none hover:text-foreground">
                Technical details
              </summary>
              <div className="space-y-2 border-t px-3 py-2">
                {route && (
                  <p className="font-mono text-[11px] break-all text-muted-foreground">{route}</p>
                )}
                {stack && (
                  <pre className="max-h-64 overflow-auto font-mono text-[11px] break-all whitespace-pre-wrap text-muted-foreground">
                    {stack}
                  </pre>
                )}
              </div>
            </details>
          )}
        </CardContent>
        <CardFooter className="flex-wrap justify-end gap-2">
          {dev && (
            <>
              <Button variant="ghost" asChild>
                <a href="/">
                  <Home />
                  Back to home
                </a>
              </Button>
              <Button variant="outline" onClick={copyDetails}>
                {copied ? <Check /> : <Copy />}
                {copied ? 'Copied' : 'Copy details'}
              </Button>
            </>
          )}
          <Button onClick={() => window.location.reload()}>
            <RotateCw />
            Reload
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

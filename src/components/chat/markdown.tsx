import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {language || 'text'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={copy}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span className="sr-only">Copy code</span>
        </Button>
      </div>
      <pre className="max-h-96 overflow-auto p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('markdown text-sm', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className: codeClassName, children: codeChildren }) => {
            const match = /language-(\w+)/.exec(codeClassName ?? '')
            const text = String(codeChildren).replace(/\n$/, '')
            if (match) return <CodeBlock code={text} language={match[1]} />
            return (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{text}</code>
            )
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

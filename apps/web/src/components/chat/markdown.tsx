import { isValidElement, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CodeElementProps = { className?: string; children?: ReactNode }

/**
 * `pre` receives the rendered `<code>` element. Read the language class and raw
 * text from it so every fenced or indented block can render through CodeBlock,
 * tagged or not.
 */
function readCodeElement(children: ReactNode): { code: string; language?: string } {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement<CodeElementProps>(child)) return { code: '' }

  const language = /language-([^\s]+)/.exec(child.props.className ?? '')?.[1]
  return {
    code: String(child.props.children ?? '').replace(/\n$/, ''),
    language,
  }
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5 max-md:py-0">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {language || 'text'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 opacity-0 transition-opacity group-hover:opacity-100 max-md:size-11 max-md:opacity-100"
          onClick={copy}
        >
          {copied ? (
            <Check className="size-3 max-md:size-5" />
          ) : (
            <Copy className="size-3 max-md:size-5" />
          )}
          <span className="sr-only">Copy code</span>
        </Button>
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre p-3 text-xs leading-relaxed">
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
          pre: ({ children }) => {
            const { code, language } = readCodeElement(children)
            return <CodeBlock code={code} language={language} />
          },
          code: ({ className: codeClassName, children: codeChildren }) => {
            // Block code: keep the parsed language class so `pre` can read it.
            // The element itself is replaced by CodeBlock.
            if (codeClassName?.startsWith('language-')) {
              return <code className={codeClassName}>{codeChildren}</code>
            }
            return (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                {codeChildren}
              </code>
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

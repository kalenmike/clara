import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

export function Markdown({ children, breaks = false }: { children: string; breaks?: boolean }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={breaks ? [remarkGfm, remarkBreaks] : [remarkGfm]}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

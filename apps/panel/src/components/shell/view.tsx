import type { ReactNode } from 'react'

/** Shared workbench view header. Mirrors the Clara Lab view-head pattern. */
export function View({
  id,
  kicker,
  title,
  description,
  actions,
  children,
}: {
  id: string
  kicker: string
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
}) {
  const headingId = `${id}-title`

  return (
    <section className="panel-view" aria-labelledby={headingId}>
      <header className="panel-view-head">
        <div>
          <div className="panel-view-kicker">{kicker}</div>
          <h1 id={headingId}>{title}</h1>
          <p>{description}</p>
        </div>
        {actions ? <div className="panel-view-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}

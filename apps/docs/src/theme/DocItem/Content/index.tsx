import type { ReactNode } from 'react'
import Content from '@theme-original/DocItem/Content'
import type ContentType from '@theme/DocItem/Content'
import type { WrapperProps } from '@docusaurus/types'
import { useDoc } from '@docusaurus/plugin-content-docs/client'

type Props = WrapperProps<typeof ContentType>

export default function DocItemContent(props: Props): ReactNode {
  const { metadata } = useDoc()
  const internal = metadata.permalink.startsWith('/internals')

  return (
    <>
      {internal && (
        <aside className="internal-doc-banner" role="note">
          <strong>Internal documentation</strong>
          <span>
            Describes implementation details and may reference source files. For end-user help, read
            the <a href="/guide/">user guide</a>.
          </span>
        </aside>
      )}
      <Content {...props} />
    </>
  )
}

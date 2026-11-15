import { useEffect } from 'react'
import { router } from '@/router'
import { useConnection } from '@/providers/connection-provider'
import { subscribeAdapterHostLinks, takeAdapterHostLink } from '@/lib/desktop-adapter-host'
import {
  readPendingAdapterLink,
  storePendingAdapterLink,
  type PendingAdapterLink,
} from './adapter-link'

/**
 * Carries a `clara://adapter` link from the desktop shell to the hub panel.
 * The panel owns adapter pairing, so the link opens `/hub#harness` and hands it
 * the one-time code instead of opening a second dialog in Settings.
 */
export function AdapterLinkWatcher() {
  const { status } = useConnection()

  useEffect(() => {
    const receive = (link: PendingAdapterLink) => {
      storePendingAdapterLink(link)
      if (status === 'connected') router.navigate('/hub#harness', { state: { adapterLink: link } })
    }

    void takeAdapterHostLink().then((link) => {
      if (link) receive(link)
    })
    return subscribeAdapterHostLinks(receive)
  }, [status])

  useEffect(() => {
    if (status !== 'connected') return
    const pending = readPendingAdapterLink()
    if (!pending) return
    router.navigate('/hub#harness', { state: { adapterLink: pending } })
  }, [status])

  return null
}

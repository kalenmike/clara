/* Clara Web Push handlers. Loaded by the generated Workbox service worker. */

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const url = typeof data.url === 'string' && data.url.length > 0 ? data.url : '/'
  event.waitUntil(focusOrOpen(url))
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(notifyClientsOfSubscriptionChange())
})

async function handlePush(event) {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = typeof payload.title === 'string' ? payload.title : 'Clara'
  const body =
    typeof payload.body === 'string' && payload.body.length > 0
      ? payload.body
      : 'A session needs you.'
  const url = typeof payload.url === 'string' && payload.url.length > 0 ? payload.url : '/'
  const tag = typeof payload.tag === 'string' && payload.tag.length > 0 ? payload.tag : 'clara'
  const isTest = payload.sessionID === 'test' || tag === 'clara:test'

  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })
  const handledByVisiblePage =
    !isTest &&
    clients.some((client) => client.visibilityState === 'visible' && !isConnectUrl(client.url))
  if (handledByVisiblePage) return

  await self.registration.showNotification(title, {
    body,
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag,
    data: {
      url,
      sessionID: typeof payload.sessionID === 'string' ? payload.sessionID : undefined,
      kind: typeof payload.kind === 'string' ? payload.kind : undefined,
    },
    silent: false,
  })
}

async function focusOrOpen(url) {
  const target = new URL(url, self.location.origin).href
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })

  for (const client of clients) {
    try {
      if (new URL(client.url).origin !== self.location.origin) continue
      await client.focus()
      if (typeof client.navigate === 'function') await client.navigate(target)
      return
    } catch {
      // Try the next client, then open a fresh window.
    }
  }

  if (self.clients.openWindow) await self.clients.openWindow(target)
}

async function notifyClientsOfSubscriptionChange() {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })
  for (const client of clients) {
    client.postMessage({ type: 'clara.push.subscription-change' })
  }
}

function isConnectUrl(value) {
  try {
    return new URL(value, self.location.origin).pathname === '/connect'
  } catch {
    return false
  }
}

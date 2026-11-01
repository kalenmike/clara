import { describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import type { SessionInfo } from '@opencode/client'
import type { OpenCodeClient } from '@/lib/client'
import { queryKeys } from '@/lib/query-keys'
import { unsnoozeSessionOnEngage } from './unsnooze'

function harness(metadata: SessionInfo['metadata']) {
  const session = { id: 'ses_1', metadata } as SessionInfo
  const client = {
    session: {
      get: vi.fn(() => Promise.resolve(session)),
      update: vi.fn(() => Promise.resolve(session)),
    },
  } as unknown as OpenCodeClient
  const queryClient = {
    getQueryData: vi.fn(() => session),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(() => Promise.resolve()),
  } as unknown as QueryClient
  return { session, client, queryClient }
}

describe('unsnoozeSessionOnEngage', () => {
  it('leaves a session that is not snoozed alone', async () => {
    const { client, queryClient } = harness({ pinned: true })

    await unsnoozeSessionOnEngage(client, queryClient, 'ses_1')

    expect(client.session.update).not.toHaveBeenCalled()
    expect(queryClient.setQueryData).not.toHaveBeenCalled()
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
  })

  it('clears the marker and keeps the other metadata keys', async () => {
    const { client, queryClient } = harness({ pinned: true, snoozed: true })

    await unsnoozeSessionOnEngage(client, queryClient, 'ses_1')

    expect(client.session.update).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      metadata: { pinned: true },
    })
    expect(queryClient.setQueryData).toHaveBeenCalledWith(queryKeys.session('ses_1'), {
      id: 'ses_1',
      metadata: { pinned: true },
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sessions'] })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.session('ses_1'),
    })
  })

  it('does not block the caller when the write fails', async () => {
    const { client, queryClient } = harness({ snoozed: true })
    vi.mocked(client.session.update).mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('window', { localStorage: { getItem: () => null } })

    await expect(
      unsnoozeSessionOnEngage(client, queryClient, 'ses_1')
    ).resolves.toBeUndefined()
    expect(queryClient.setQueryData).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

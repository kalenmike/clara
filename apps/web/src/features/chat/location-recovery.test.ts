import { QueryClient } from '@tanstack/react-query'
import type { Project, SessionInfo } from '@opencode/client'
import { describe, expect, it, vi } from 'vitest'
import type { OpenCodeClient } from '@/lib/client'
import { queryKeys } from '@/lib/query-keys'
import {
  isMissingDirectoryError,
  LocationRecoveryError,
  withLocationRecovery,
} from './location-recovery'

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function missingDirectory(directory = '/gone'): unknown {
  return Object.assign(new Error(`Location not found: ${directory}`), {
    _tag: 'LocationNotFoundError' as const,
    location: { directory },
  })
}

function recoveryContext() {
  const queryClient = new QueryClient()
  queryClient.setQueryData<SessionInfo>(queryKeys.session('ses_1'), {
    id: 'ses_1',
    projectID: 'proj_1',
    location: { directory: '/gone' },
  } as SessionInfo)
  queryClient.setQueryData<Project[]>(queryKeys.projects, [
    {
      id: 'proj_1',
      canonical: '/base',
      time: { created: 0, updated: 0, active: 0 },
      sandboxes: [],
    } as Project,
  ])

  const move = vi.fn().mockResolvedValue(undefined)
  const client = {
    session: { move },
  } as unknown as OpenCodeClient

  return { client, queryClient, move }
}

describe('isMissingDirectoryError', () => {
  it('matches only the server location error', () => {
    expect(isMissingDirectoryError(missingDirectory())).toBe(true)
    expect(isMissingDirectoryError(new Error('Location not found: /gone'))).toBe(false)
    expect(isMissingDirectoryError({ _tag: 'SessionNotFoundError' })).toBe(false)
  })
})

describe('withLocationRecovery', () => {
  it('moves to the project canonical directory and retries once', async () => {
    const { client, queryClient, move } = recoveryContext()
    const send = vi.fn().mockRejectedValueOnce(missingDirectory()).mockResolvedValueOnce('sent')

    const result = await withLocationRecovery({ client, queryClient, sessionID: 'ses_1' }, send)

    expect(result).toBe('sent')
    expect(move).toHaveBeenCalledWith({ sessionID: 'ses_1', directory: '/base' })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('reports a recovery error when the base directory cannot be found', async () => {
    const { client, queryClient, move } = recoveryContext()
    queryClient.setQueryData(queryKeys.projects, [])
    const send = vi.fn().mockRejectedValueOnce(missingDirectory())

    await expect(
      withLocationRecovery({ client, queryClient, sessionID: 'ses_1' }, send)
    ).rejects.toBeInstanceOf(LocationRecoveryError)
    expect(move).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('reports a recovery error when the retry fails', async () => {
    const { client, queryClient, move } = recoveryContext()
    const send = vi
      .fn()
      .mockRejectedValueOnce(missingDirectory())
      .mockRejectedValueOnce(new Error('still failing'))

    await expect(
      withLocationRecovery({ client, queryClient, sessionID: 'ses_1' }, send)
    ).rejects.toBeInstanceOf(LocationRecoveryError)
    expect(move).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('leaves unrelated errors alone', async () => {
    const { client, queryClient, move } = recoveryContext()
    const failure = new Error('provider auth')
    const send = vi.fn().mockRejectedValueOnce(failure)

    await expect(
      withLocationRecovery({ client, queryClient, sessionID: 'ses_1' }, send)
    ).rejects.toBe(failure)
    expect(move).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
  })
})

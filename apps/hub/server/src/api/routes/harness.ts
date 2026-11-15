import { describeRoute, resolver, validator } from 'hono-openapi'
import type { Hono } from 'hono'
import {
  claraAdapterInstallManifestResponseSchema,
  claraHarnessPairingRequestSchema,
  claraHarnessPairingResponseSchema,
} from '@clara/api-contract'
import { readInstallFailure } from '@clara/adapter-install'
import { readControlFailure } from '../../panel/controls.ts'
import { ApiRequestError, type ApiDependencies, type ApiVariables } from '../context.ts'
import { jsonResponse, responses } from '../schemas.ts'

export function registerHarnessRoutes(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  app.get(
    '/v1/harness/adapters/:kind',
    describeRoute({
      tags: ['harness'],
      operationId: 'getAdapterManifest',
      summary: 'Read one adapter release manifest',
      description:
        'Returns the registry manifest the hub would use for an adapter install. The hub ' +
        'never downloads the artifact.',
      responses: responses(
        jsonResponse(resolver(claraAdapterInstallManifestResponseSchema), 'Adapter manifest')
      ),
    }),
    async (c) => {
      if (!deps.adapterManifest) {
        throw new ApiRequestError(
          503,
          'install_unavailable',
          'Adapter setup is not available on this hub.'
        )
      }
      try {
        return c.json({ manifest: await deps.adapterManifest(c.req.param('kind')) })
      } catch (cause) {
        const failure = readInstallFailure(cause) ?? readControlFailure(cause)
        if (failure) {
          throw new ApiRequestError(failure.status, failure.code, failure.message)
        }
        throw cause
      }
    }
  )

  app.post(
    '/v1/harness/pairings',
    describeRoute({
      tags: ['harness'],
      operationId: 'createHarnessPairing',
      summary: 'Create a one-time adapter pairing',
      description:
        'Issues a pairing code and the install command for a harness adapter. The hub never ' +
        'runs the install; the person runs it on the machine that hosts the harness.',
      responses: responses(
        jsonResponse(resolver(claraHarnessPairingResponseSchema), 'Adapter pairing offer')
      ),
    }),
    validator('json', claraHarnessPairingRequestSchema),
    async (c) => {
      const input = c.req.valid('json')
      if (!deps.createAdapterPairing) {
        throw new ApiRequestError(
          503,
          'install_unavailable',
          'Adapter setup is not available on this hub.'
        )
      }
      try {
        return c.json(await deps.createAdapterPairing(input))
      } catch (cause) {
        const failure = readInstallFailure(cause) ?? readControlFailure(cause)
        if (failure) {
          throw new ApiRequestError(failure.status, failure.code, failure.message)
        }
        throw cause
      }
    }
  )
}

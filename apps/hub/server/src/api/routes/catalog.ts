import { describeRoute, resolver, validator } from 'hono-openapi'
import type { Hono } from 'hono'
import { z } from 'zod'
import {
  claraAgentListOutputSchema,
  claraCommandListOutputSchema,
  claraModelListOutputSchema,
  claraProviderListOutputSchema,
  claraReferenceListOutputSchema,
  claraSkillListOutputSchema,
} from '@clara/api-contract'
import type { ApiDependencies, ApiVariables } from '../context.ts'
import {
  forwardDtoTo,
  parseClaraAgentList,
  parseClaraCommandList,
  parseClaraModelList,
  parseClaraProviderList,
  parseClaraReferenceList,
  parseClaraSkillList,
} from '../dto.ts'
import { locationQuery } from '../harness.ts'
import { requireHarnessContext, resolveHarnessForDirectory } from '../harness-scope.ts'
import { jsonResponse, responses } from '../schemas.ts'

const catalogQuery = z.object({ harnessID: z.string().min(1).optional() })
const locationCatalogQuery = z.object({
  directory: z.string().optional(),
  harnessID: z.string().min(1).optional(),
})

export function registerCatalogRoutes(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  app.get(
    '/v1/agents',
    describeRoute({
      tags: ['catalog'],
      operationId: 'listAgents',
      summary: 'List agents',
      responses: responses(jsonResponse(resolver(claraAgentListOutputSchema), 'Agents')),
    }),
    validator('query', catalogQuery),
    async (c) => {
      const { harnessID } = c.req.valid('query')
      const harness = requireHarnessContext(deps, harnessID)
      const result = await forwardDtoTo(
        deps,
        harness,
        { method: 'GET', path: '/agents' },
        c.req.raw.signal,
        parseClaraAgentList
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/models',
    describeRoute({
      tags: ['catalog'],
      operationId: 'listModels',
      summary: 'List models',
      responses: responses(jsonResponse(resolver(claraModelListOutputSchema), 'Models')),
    }),
    validator('query', catalogQuery),
    async (c) => {
      const { harnessID } = c.req.valid('query')
      const harness = requireHarnessContext(deps, harnessID)
      const result = await forwardDtoTo(
        deps,
        harness,
        { method: 'GET', path: '/models' },
        c.req.raw.signal,
        parseClaraModelList
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/providers',
    describeRoute({
      tags: ['catalog'],
      operationId: 'listProviders',
      summary: 'List providers',
      responses: responses(jsonResponse(resolver(claraProviderListOutputSchema), 'Providers')),
    }),
    validator('query', catalogQuery),
    async (c) => {
      const { harnessID } = c.req.valid('query')
      const harness = requireHarnessContext(deps, harnessID)
      const result = await forwardDtoTo(
        deps,
        harness,
        { method: 'GET', path: '/providers' },
        c.req.raw.signal,
        parseClaraProviderList
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/commands',
    describeRoute({
      tags: ['catalog'],
      operationId: 'listCommands',
      summary: 'List commands',
      responses: responses(jsonResponse(resolver(claraCommandListOutputSchema), 'Commands')),
    }),
    validator('query', catalogQuery),
    async (c) => {
      const { harnessID } = c.req.valid('query')
      const harness = requireHarnessContext(deps, harnessID)
      const result = await forwardDtoTo(
        deps,
        harness,
        { method: 'GET', path: '/commands' },
        c.req.raw.signal,
        parseClaraCommandList
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/skills',
    describeRoute({
      tags: ['catalog'],
      operationId: 'listSkills',
      summary: 'List skills for a location',
      responses: responses(jsonResponse(resolver(claraSkillListOutputSchema), 'Skills')),
    }),
    validator('query', locationCatalogQuery),
    async (c) => {
      const { directory, harnessID } = c.req.valid('query')
      const harness = resolveHarnessForDirectory(deps, directory, harnessID)
      const result = await forwardDtoTo(
        deps,
        harness,
        {
          method: 'GET',
          path: '/skills',
          search: locationQuery(directory),
        },
        c.req.raw.signal,
        parseClaraSkillList
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/references',
    describeRoute({
      tags: ['catalog'],
      operationId: 'listReferences',
      summary: 'List references for a location',
      responses: responses(jsonResponse(resolver(claraReferenceListOutputSchema), 'References')),
    }),
    validator('query', locationCatalogQuery),
    async (c) => {
      const { directory, harnessID } = c.req.valid('query')
      const harness = resolveHarnessForDirectory(deps, directory, harnessID)
      const result = await forwardDtoTo(
        deps,
        harness,
        {
          method: 'GET',
          path: '/references',
          search: locationQuery(directory),
        },
        c.req.raw.signal,
        parseClaraReferenceList
      )
      return c.json(result)
    }
  )
}

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
  forwardDto,
  parseClaraAgentList,
  parseClaraCommandList,
  parseClaraModelList,
  parseClaraProviderList,
  parseClaraReferenceList,
  parseClaraSkillList,
} from '../dto.ts'
import { query } from '../harness.ts'
import { jsonResponse, responses } from '../schemas.ts'

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
    async (c) => {
      const result = await forwardDto(
        deps,
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
    async (c) => {
      const result = await forwardDto(
        deps,
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
    async (c) => {
      const result = await forwardDto(
        deps,
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
    async (c) => {
      const result = await forwardDto(
        deps,
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
    validator('query', z.object({ directory: z.string().optional() })),
    async (c) => {
      const { directory } = c.req.valid('query')
      const result = await forwardDto(
        deps,
        {
          method: 'GET',
          path: '/skills',
          search: query({ location: { directory } }),
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
    validator('query', z.object({ directory: z.string().optional() })),
    async (c) => {
      const { directory } = c.req.valid('query')
      const result = await forwardDto(
        deps,
        {
          method: 'GET',
          path: '/references',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal,
        parseClaraReferenceList
      )
      return c.json(result)
    }
  )
}

import { describeRoute, validator } from 'hono-openapi'
import type { Hono } from 'hono'
import { z } from 'zod'
import type {
  AgentListOutput,
  CommandListOutput,
  ModelListOutput,
  ProviderListOutput,
  ReferenceListOutput,
  SkillListOutput,
} from '@opencode/client'
import type { ApiDependencies, ApiVariables } from '../context.ts'
import { forwardResult, query } from '../harness.ts'
import { jsonResponse, ref, responses } from '../schemas.ts'

export function registerCatalogRoutes(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  app.get(
    '/v1/agents',
    describeRoute({
      tags: ['catalog'],
      operationId: 'listAgents',
      summary: 'List OpenCode agents',
      responses: responses(jsonResponse(ref('AgentListOutput'), 'Agents')),
    }),
    async (c) => {
      const result = await forwardResult<AgentListOutput>(
        deps,
        { method: 'GET', path: '/api/agent' },
        c.req.raw.signal
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/models',
    describeRoute({
      tags: ['catalog'],
      operationId: 'listModels',
      summary: 'List OpenCode models',
      responses: responses(jsonResponse(ref('ModelListOutput'), 'Models')),
    }),
    async (c) => {
      const result = await forwardResult<ModelListOutput>(
        deps,
        { method: 'GET', path: '/api/model' },
        c.req.raw.signal
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/providers',
    describeRoute({
      tags: ['catalog'],
      operationId: 'listProviders',
      summary: 'List OpenCode providers',
      responses: responses(jsonResponse(ref('ProviderListOutput'), 'Providers')),
    }),
    async (c) => {
      const result = await forwardResult<ProviderListOutput>(
        deps,
        { method: 'GET', path: '/api/provider' },
        c.req.raw.signal
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/commands',
    describeRoute({
      tags: ['catalog'],
      operationId: 'listCommands',
      summary: 'List OpenCode commands',
      responses: responses(jsonResponse(ref('CommandListOutput'), 'Commands')),
    }),
    async (c) => {
      const result = await forwardResult<CommandListOutput>(
        deps,
        { method: 'GET', path: '/api/command' },
        c.req.raw.signal
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
      responses: responses(jsonResponse(ref('SkillListOutput'), 'Skills')),
    }),
    validator('query', z.object({ directory: z.string().optional() })),
    async (c) => {
      const { directory } = c.req.valid('query')
      const result = await forwardResult<SkillListOutput>(
        deps,
        {
          method: 'GET',
          path: '/api/skill',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal
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
      responses: responses(jsonResponse(ref('ReferenceListOutput'), 'References')),
    }),
    validator('query', z.object({ directory: z.string().optional() })),
    async (c) => {
      const { directory } = c.req.valid('query')
      const result = await forwardResult<ReferenceListOutput>(
        deps,
        {
          method: 'GET',
          path: '/api/reference',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal
      )
      return c.json(result)
    }
  )
}

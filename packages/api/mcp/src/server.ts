import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ClaraApiReadBackend } from './types.ts'

const text = (value: unknown) => {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const structuredContent = Array.isArray(value)
    ? { items: value }
    : value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined
  return {
    content: [{ type: 'text' as const, text: body }],
    ...(structuredContent ? { structuredContent } : {}),
  }
}

export const SERVER_INSTRUCTIONS = `You are connected to a running Clara hub through a read-only MCP server.

Use these tools to inspect the live Clara projects and workspaces, sessions, messages, catalog, VCS
state, and Git history that the Clara web client displays. You cannot send
prompts, answer permissions, change sessions, or modify anything.

Start with clara_api_info, then clara_projects_list and clara_sessions_list.
Use clara_api_openapi when you need the full API surface or request shapes.
The hub must be running and reachable at the configured local API URL.`

export function createClaraApiServer(backend: ClaraApiReadBackend, version = '0.1.0'): McpServer {
  const server = new McpServer(
    { name: 'clara-api', version },
    { instructions: SERVER_INSTRUCTIONS }
  )

  server.registerTool(
    'clara_api_info',
    {
      description:
        'Read hub status, paired harness counts, and the API version. Start here before listing data.',
      inputSchema: {},
    },
    async () => text(await backend.info())
  )

  server.registerTool(
    'clara_api_openapi',
    {
      description:
        'Return the OpenAPI document for the Clara hub API. Use it to discover endpoints and response shapes.',
      inputSchema: {},
    },
    async () => text(await backend.openapi())
  )

  server.registerTool(
    'clara_harness_info',
    {
      description: 'Read one paired harness server information.',
      inputSchema: {
        harnessID: z.string().min(1).describe('The paired harness to probe'),
      },
    },
    async ({ harnessID }) => text(await backend.harnessInfo(harnessID))
  )

  server.registerTool(
    'clara_projects_list',
    {
      description: 'List Clara projects and their harness workspaces.',
      inputSchema: {
        archived: z
          .boolean()
          .optional()
          .describe('List archived projects instead of active projects'),
      },
    },
    async (args) => text(await backend.projects(args))
  )

  server.registerTool(
    'clara_sessions_list',
    {
      description:
        'List sessions. Filter by project, directory, search text, archived state, or parent session.',
      inputSchema: {
        limit: z.number().int().positive().optional(),
        order: z.enum(['asc', 'desc']).optional(),
        search: z.string().optional(),
        parent_id: z.string().optional(),
        archived: z.boolean().optional(),
        directory: z.string().optional(),
        project: z.string().optional(),
        subpath: z.string().optional(),
        cursor: z.string().optional(),
      },
    },
    async (args) =>
      text(
        await backend.sessions({
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.order === undefined ? {} : { order: args.order }),
          ...(args.search === undefined ? {} : { search: args.search }),
          ...(args.parent_id === undefined ? {} : { parentID: args.parent_id }),
          ...(args.archived === undefined ? {} : { archived: args.archived }),
          ...(args.directory === undefined ? {} : { directory: args.directory }),
          ...(args.project === undefined ? {} : { project: args.project }),
          ...(args.subpath === undefined ? {} : { subpath: args.subpath }),
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
        })
      )
  )

  server.registerTool(
    'clara_session_get',
    {
      description: 'Read one session by id.',
      inputSchema: { session_id: z.string().min(1) },
    },
    async (args) => text(await backend.session(args.session_id))
  )

  server.registerTool(
    'clara_session_active',
    {
      description: 'Read the active state of every running or idle session.',
      inputSchema: {},
    },
    async () => text(await backend.activeSessions())
  )

  server.registerTool(
    'clara_messages_list',
    {
      description: 'List messages in a session, newest first by default.',
      inputSchema: {
        session_id: z.string().min(1),
        order: z.enum(['asc', 'desc']).optional(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
        type: z
          .enum([
            'compaction',
            'user',
            'synthetic',
            'agent-switched',
            'model-switched',
            'location-switched',
            'system',
            'skill',
            'shell',
            'assistant',
            'idle',
          ])
          .optional()
          .describe('Message type filter, for example user or assistant'),
      },
    },
    async (args) =>
      text(
        await backend.messages(args.session_id, {
          ...(args.order === undefined ? {} : { order: args.order }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
          ...(args.type === undefined ? {} : { type: args.type }),
        })
      )
  )

  server.registerTool(
    'clara_permissions_list',
    {
      description: 'List pending permission requests for a directory.',
      inputSchema: { directory: z.string().optional() },
    },
    async (args) => text(await backend.permissions(args))
  )

  server.registerTool(
    'clara_forms_list',
    {
      description: 'List pending question forms for a session.',
      inputSchema: { session_id: z.string().min(1) },
    },
    async (args) => text(await backend.forms(args.session_id))
  )

  server.registerTool(
    'clara_inbox_list',
    {
      description: 'List queued inbox items for a session.',
      inputSchema: { session_id: z.string().min(1) },
    },
    async (args) => text(await backend.inbox(args.session_id))
  )

  server.registerTool(
    'clara_agents_list',
    {
      description: 'List available agents for one paired harness.',
      inputSchema: { harnessID: z.string().min(1) },
    },
    async ({ harnessID }) => text(await backend.agents(harnessID))
  )

  server.registerTool(
    'clara_models_list',
    {
      description: 'List available models and providers for one paired harness.',
      inputSchema: { harnessID: z.string().min(1) },
    },
    async ({ harnessID }) => text(await backend.models(harnessID))
  )

  server.registerTool(
    'clara_providers_list',
    {
      description: 'List configured providers for one paired harness.',
      inputSchema: { harnessID: z.string().min(1) },
    },
    async ({ harnessID }) => text(await backend.providers(harnessID))
  )

  server.registerTool(
    'clara_commands_list',
    {
      description: 'List slash commands for one paired harness.',
      inputSchema: { harnessID: z.string().min(1) },
    },
    async ({ harnessID }) => text(await backend.commands(harnessID))
  )

  server.registerTool(
    'clara_skills_list',
    {
      description: 'List skills for a directory on one paired harness.',
      inputSchema: { harnessID: z.string().min(1), directory: z.string().optional() },
    },
    async (args) => text(await backend.skills(args))
  )

  server.registerTool(
    'clara_references_list',
    {
      description: 'List references for a directory on one paired harness.',
      inputSchema: { harnessID: z.string().min(1), directory: z.string().optional() },
    },
    async (args) => text(await backend.references(args))
  )

  server.registerTool(
    'clara_locations_get',
    {
      description: 'Resolve a directory to its project location record.',
      inputSchema: { directory: z.string().min(1) },
    },
    async (args) => text(await backend.location(args.directory))
  )

  server.registerTool(
    'clara_files_find',
    {
      description: 'Search files or directories under a location.',
      inputSchema: {
        directory: z.string().optional(),
        query: z.string(),
        type: z.enum(['file', 'directory']).optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (args) => text(await backend.files(args))
  )

  server.registerTool(
    'clara_vcs_get',
    {
      description: 'Read repository information for a directory.',
      inputSchema: { directory: z.string().optional() },
    },
    async (args) => text(await backend.vcs(args.directory))
  )

  server.registerTool(
    'clara_vcs_base',
    {
      description: 'Read the branch base for a directory.',
      inputSchema: { directory: z.string().optional() },
    },
    async (args) => text(await backend.vcsBase(args.directory))
  )

  server.registerTool(
    'clara_vcs_status',
    {
      description: 'Read working-tree changes for a directory.',
      inputSchema: { directory: z.string().optional() },
    },
    async (args) => text(await backend.vcsStatus(args.directory))
  )

  server.registerTool(
    'clara_vcs_diff',
    {
      description: 'Read a working, committed, or branch diff for a directory.',
      inputSchema: {
        directory: z.string().optional(),
        mode: z.enum(['working', 'branch', 'committed']),
        base: z.string().optional(),
        context: z.number().int().positive().optional(),
      },
    },
    async (args) =>
      text(
        await backend.vcsDiff({
          ...(args.directory === undefined ? {} : { directory: args.directory }),
          mode: args.mode,
          ...(args.base === undefined ? {} : { base: args.base }),
          ...(args.context === undefined ? {} : { context: args.context }),
        })
      )
  )

  server.registerTool(
    'clara_worktrees_list',
    {
      description: 'List worktrees for a project.',
      inputSchema: { project: z.string().optional() },
    },
    async (args) => text(await backend.worktrees(args))
  )

  server.registerTool(
    'clara_git_log',
    {
      description:
        'Read up to ten commits in a directory between two epoch-millisecond timestamps.',
      inputSchema: {
        directory: z.string().min(1),
        since: z.number().int().nonnegative(),
        until: z.number().int().nonnegative().optional(),
      },
    },
    async (args) => text(await backend.gitLog(args))
  )

  server.registerResource(
    'openapi',
    'clara://api/openapi',
    { description: 'Clara hub OpenAPI document', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await backend.openapi(), null, 2),
        },
      ],
    })
  )

  server.registerResource(
    'info',
    'clara://server/info',
    { description: 'Clara hub status and paired harness counts', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await backend.info(), null, 2),
        },
      ],
    })
  )

  return server
}

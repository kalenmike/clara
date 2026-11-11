import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGenerator } from 'ts-json-schema-generator'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Keep this list aligned with schema-entry.ts. The generated components are the
 * response and request bodies exposed by the Clara API. They come from the
 * pinned @opencode/client types, so Swagger stays in sync with the harness.
 */
const types = [
  'AgentListOutput',
  'CommandListOutput',
  'FileDiffInfo',
  'FileFindInput',
  'FileFindOutput',
  'FormInfo',
  'LocationPublicInfo',
  'ModelListOutput',
  'PermissionReplyInput',
  'PermissionRequest',
  'PermissionRequestListOutput',
  'Project',
  'ProjectUpdateInput',
  'ProviderListOutput',
  'ReferenceListOutput',
  'ServerInfo',
  'SessionActive',
  'SessionActiveOutput',
  'SessionCommandInput',
  'SessionCreateInput',
  'SessionFormCancelInput',
  'SessionFormReplyInput',
  'SessionForkInput',
  'SessionInboxCancelInput',
  'SessionInboxCompaction',
  'SessionInboxInfo',
  'SessionInboxSynthetic',
  'SessionInboxUser',
  'SessionInfo',
  'SessionInterruptResponse',
  'SessionMessageInfo',
  'SessionMessagesResponse',
  'SessionMoveInput',
  'SessionPromptInput',
  'SessionSwitchAgentInput',
  'SessionSwitchModelInput',
  'SessionSyntheticInput',
  'SessionUpdateInput',
  'SessionViewInput',
  'SessionsResponse',
  'SkillListOutput',
  'V2Event',
  'VcsBaseOutput',
  'VcsDiffInput',
  'VcsDiffOutput',
  'VcsFileStatus',
  'VcsGetOutput',
  'VcsStatusOutput',
  'WorktreeList',
  'WorktreeRefreshInput',
]

const generator = createGenerator({
  path: join(packageRoot, 'schema-entry.ts'),
  tsconfig: join(packageRoot, 'tsconfig.json'),
  expose: 'all',
  topRef: true,
  skipTypeCheck: true,
  jsDoc: 'none',
  sortProps: true,
})

const definitions: Record<string, unknown> = {}

for (const type of types) {
  const schema = generator.createSchema(type)
  for (const [name, definition] of Object.entries(schema.definitions ?? {})) {
    definitions[name] = definition
  }
}

const output = `${JSON.stringify({ definitions }, null, 2)}\n`
const target = join(packageRoot, 'src', 'generated', 'schemas.json')

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : ''
  if (current !== output) {
    console.error(
      'OpenAPI components are out of date. Run `pnpm --filter @clara/api-contract generate:schemas`.'
    )
    process.exit(1)
  }
  console.log('OpenAPI components are up to date.')
} else {
  mkdirSync(join(packageRoot, 'src', 'generated'), { recursive: true })
  writeFileSync(target, output)
}

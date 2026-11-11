import raw from './generated/schemas.json' with { type: 'json' }

const rewritten = JSON.stringify(raw).replaceAll('#/definitions/', '#/components/schemas/')
const parsed = JSON.parse(rewritten) as { definitions: Record<string, unknown> }

/** OpenAPI components generated from the pinned @opencode/client types. */
export const openApiSchemas = parsed.definitions

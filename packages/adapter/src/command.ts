import { existsSync, readFileSync, unlinkSync } from 'node:fs'

const MCP_COMMAND_MARKER = '<!-- clara:mcp-work-order -->'
const GENERATED_DESCRIPTIONS = [
  'Start a Clara orchestration pipeline for this request',
  'Start a Clara orchestration pipeline for the following request.',
]
const GENERATED_CALLS = ['Call the `clara_start` tool', 'Call the Clara start tool']

function isGeneratedCommand(body: string): boolean {
  if (body.includes(MCP_COMMAND_MARKER)) return true
  return (
    GENERATED_DESCRIPTIONS.some((line) => body.includes(line)) &&
    GENERATED_CALLS.some((line) => body.includes(line))
  )
}

/** Remove the old installer-generated /pipeline command, never a human's. */
export function removeGeneratedCommand(path: string): boolean {
  if (!existsSync(path)) return false
  const body = readFileSync(path, 'utf8')
  if (!isGeneratedCommand(body)) return false
  unlinkSync(path)
  return true
}

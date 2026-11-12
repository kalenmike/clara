import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const plugin = join(process.cwd(), 'dist', 'plugin')
mkdirSync(plugin, { recursive: true })
const agents = join(process.cwd(), 'plugin', 'agents')
if (existsSync(agents)) cpSync(agents, join(plugin, 'agents'), { recursive: true })
writeFileSync(
  join(plugin, 'package.json'),
  `${JSON.stringify({ name: 'clara-opencode-policy', type: 'module', exports: './index.js' }, null, 2)}\n`
)

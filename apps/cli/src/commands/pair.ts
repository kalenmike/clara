import { main } from '@clara/hub-server/main'
import { resolvePaths } from '../paths.ts'
import { detectRole } from '../state/role.ts'
import { runPairAdapter } from './adapter-install.ts'
import { pairingGuard } from './role-guard.ts'

/** `clara pair hub` pairs a browser; `clara pair adapter` issues an adapter code. */
export async function runPair(args: readonly string[]): Promise<number> {
  const target = args[0]
  if (target !== undefined && target !== 'hub' && target !== 'adapter' && !target.startsWith('-')) {
    console.error(`unknown pair target: ${target} (expected hub or adapter)`)
    return 2
  }
  const pairing = target === 'adapter' ? 'adapter' : 'hub'
  const guard = pairingGuard(detectRole(resolvePaths()), pairing)
  if (guard) {
    console.error(guard)
    return 1
  }
  if (target === 'adapter') return runPairAdapter(args.slice(1))
  const forwarded = target === 'hub' ? args.slice(1) : args
  await main(['pair', ...forwarded])
  return typeof process.exitCode === 'number' ? process.exitCode : 0
}

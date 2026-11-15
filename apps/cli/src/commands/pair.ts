import { main } from '@clara/hub-server/main'
import { runPairAdapter } from './adapter-install.ts'

/** `clara pair hub` pairs a browser; `clara pair adapter` issues an adapter code. */
export async function runPair(args: readonly string[]): Promise<number> {
  const target = args[0]
  if (target === 'adapter') return runPairAdapter(args.slice(1))
  if (target !== undefined && target !== 'hub' && !target.startsWith('-')) {
    console.error(`unknown pair target: ${target} (expected hub or adapter)`)
    return 2
  }
  const forwarded = target === 'hub' ? args.slice(1) : args
  await main(['pair', ...forwarded])
  return typeof process.exitCode === 'number' ? process.exitCode : 0
}

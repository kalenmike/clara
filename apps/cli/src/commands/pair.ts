import { main } from '@clara/hub-server/main'

/** `clara pair hub` runs the hub pairing command against the hub database. */
export async function runPair(args: readonly string[]): Promise<number> {
  const target = args[0]
  if (target !== undefined && target !== 'hub' && !target.startsWith('-')) {
    console.error(`unknown pair target: ${target} (expected hub)`)
    return 2
  }
  const forwarded = target === 'hub' ? args.slice(1) : args
  await main(['pair', ...forwarded])
  return typeof process.exitCode === 'number' ? process.exitCode : 0
}

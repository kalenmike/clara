import { runRunner } from '@clara/runner'

/**
 * `clara __serve runner` runs the shared script runner in this process, using
 * the saved runner config and environment defaults.
 */
export async function serveRunner(args: readonly string[] = []): Promise<void> {
  await runRunner([...args])
}

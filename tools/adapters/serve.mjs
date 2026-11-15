#!/usr/bin/env node
// Serve a locally built adapter registry on the loopback interface.
//
//   pnpm adapters:serve [--dir dist/adapters] [--port 8799] [--host 127.0.0.1]
//
// Point the packaged command or the hub at the printed URL:
//
//   export CLARA_ADAPTER_REGISTRY_URL=http://127.0.0.1:8799
//   clara adapter install opencode

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const CONTENT_TYPES = new Map([
  ['.json', 'application/json; charset=utf-8'],
  ['.sh', 'text/x-shellscript; charset=utf-8'],
  ['.gz', 'application/gzip'],
  ['.tgz', 'application/gzip'],
  ['.zip', 'application/zip'],
])

/**
 * Start a read-only static server for a registry directory.
 *
 * @param {{ dir?: string; host?: string; port?: number; log?: (line: string) => void }} [options]
 * @returns {Promise<{ url: string; close: () => Promise<void> }>}
 */
export function serveRegistry(options = {}) {
  const root = resolve(options.dir ?? join(here, '..', '..', 'dist', 'adapters'))
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 8799
  const log = options.log ?? ((line) => console.log(line))

  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      respond(response, 405, 'Method not allowed')
      return
    }
    const path = decodePath(request.url ?? '/')
    const target = resolve(join(root, path))
    if (target !== root && !target.startsWith(root + sep)) {
      respond(response, 403, 'Forbidden')
      return
    }
    try {
      const info = await stat(target)
      if (!info.isFile()) {
        respond(response, 404, 'Not found')
        return
      }
      response.writeHead(200, {
        'content-type': CONTENT_TYPES.get(extname(target)) ?? 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-store',
      })
      if (request.method === 'HEAD') {
        response.end()
        return
      }
      createReadStream(target).pipe(response)
    } catch {
      respond(response, 404, 'Not found')
    }
  })

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const url = `http://${host}:${port}`
      log(`Serving ${root}`)
      log(`  export CLARA_ADAPTER_REGISTRY_URL=${url}`)
      resolvePromise({
        url,
        close: () => new Promise((closed) => server.close(() => closed())),
      })
    })
  })
}

function decodePath(value) {
  const path = value.split('?')[0] ?? '/'
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function respond(response, status, message) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(`${message}\n`)
}

function parseArgs(args) {
  const options = { dir: undefined, host: undefined, port: undefined }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dir') options.dir = args[++index]
    else if (arg === '--host') options.host = args[++index]
    else if (arg === '--port') options.port = Number(args[++index])
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown option: ${arg}`)
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port <= 0)) {
    throw new Error('--port must be a positive integer')
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      console.log(
        'Usage: pnpm adapters:serve [--dir dist/adapters] [--port 8799] [--host 127.0.0.1]'
      )
    } else {
      await serveRegistry(options)
    }
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  }
}

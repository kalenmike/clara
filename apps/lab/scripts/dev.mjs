import { spawn } from 'node:child_process'

const commands = [
  ['pnpm', ['--filter', '@clara/lab', 'dev:server']],
  ['pnpm', ['--filter', '@clara/lab', 'dev:web']],
]

const children = commands.map(([command, args]) => {
  const child = spawn(command, args, { stdio: 'inherit' })
  child.on('exit', (code) => {
    for (const other of children) {
      if (other !== child) other.kill('SIGTERM')
    }
    process.exitCode = code ?? 0
  })
  return child
})

const stop = () => {
  for (const child of children) child.kill('SIGTERM')
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

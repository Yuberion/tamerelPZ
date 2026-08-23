/**
 * Launcher used by every npm script in this project.
 *
 * VS Code's integrated terminal exports `ELECTRON_RUN_AS_NODE=1` into child
 * processes (its extension host needs it). If that variable survives, the
 * Electron binary boots as plain Node, `require('electron')` returns a path
 * string instead of the API object, and the app dies with
 * "Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')".
 *
 * So: scrub the variable, then hand off to electron-vite (or Electron itself).
 *
 *   node scripts/run.mjs vite dev        -> electron-vite dev
 *   node scripts/run.mjs vite build      -> electron-vite build
 *   node scripts/run.mjs electron        -> electron . (runs ./out)
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

const [target, ...args] = process.argv.slice(2)

let command
let commandArgs

if (target === 'electron') {
  // The electron package exports the absolute path of its binary.
  command = require('electron')
  commandArgs = [root, ...args]
} else if (target === 'vite') {
  command = process.execPath
  commandArgs = [join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), ...args]
} else {
  console.error(`Unknown run target: ${target ?? '(none)'}`)
  process.exit(1)
}

const child = spawn(command, commandArgs, { cwd: root, env, stdio: 'inherit' })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})

import { readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSONC } from 'bun'

try {
  const name = '@jurislm/judicial-mcp'
  const source = process.env.JUDICIAL_ENV_FILE
  if (!process.env.HOME || !source || !isAbsolute(source)) throw new Error()
  const runtime = realpathSync(join(process.env.HOME, '.local/share/jurislm/mcp/judicial-mcp'))
  const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
  const manifest = readJson(join(runtime, 'package.json'))
  const version = manifest.dependencies?.[name]
  const lock = JSONC.parse(readFileSync(join(runtime, 'bun.lock'), 'utf8'))
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version)) throw new Error()
  if (lock.workspaces?.['']?.dependencies?.[name] !== version || lock.packages?.[name]?.[0] !== `${name}@${version}`) throw new Error()
  const installed = join(runtime, 'node_modules', name)
  const pkg = readJson(join(installed, 'package.json'))
  if (pkg.name !== name || pkg.version !== version || pkg.bin?.['judicial-mcp'] !== 'dist/judicial-mcp.mjs') throw new Error()
  const entry = realpathSync(join(installed, pkg.bin['judicial-mcp']))
  const location = relative(runtime, entry)
  if (location.startsWith(`..${sep}`) || isAbsolute(location) || !statSync(entry).isFile()) throw new Error()
  const allowed = new Set(['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'FIRECRAWL_API_URL'])
  for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key]
  process.env.DOTENV_CONFIG_PATH = '/dev/null'
  const require = createRequire(join(realpathSync(installed), 'package.json'))
  const { parse } = require('dotenv')
  const { JUDICIAL_USER: user, JUDICIAL_USERNAME: alias, JUDICIAL_PASSWORD: password } = parse(readFileSync(source))
  const username = user ?? alias
  if (!username || !password || (user && alias && user !== alias)) throw new Error()
  process.env.JUDICIAL_USER = username
  process.env.JUDICIAL_PASSWORD = password
  process.chdir(runtime)
  await import(pathToFileURL(entry).href)
} catch {
  process.stderr.write('Judicial desktop startup failed: verify the fixed runtime installation and the configured credential file.\n')
  process.exitCode = 1
}

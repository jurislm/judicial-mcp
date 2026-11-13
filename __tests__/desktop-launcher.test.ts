import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const roots: string[] = []
const name = '@jurislm/judicial-mcp'
const launcher = resolve('launchers/judicial-desktop.mjs')
const require = createRequire(import.meta.url)
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'judicial-desktop-'))
  roots.push(home)
  const runtime = join(home, '.local/share/jurislm/mcp/judicial-mcp')
  const installed = join(runtime, 'node_modules', name)
  mkdirSync(join(installed, 'dist'), { recursive: true })
  writeFileSync(join(runtime, 'package.json'), JSON.stringify({ dependencies: { [name]: '1.8.3' } }))
  writeFileSync(join(runtime, 'bun.lock'), JSON.stringify({ workspaces: { '': { dependencies: { [name]: '1.8.3' } } }, packages: { [name]: [`${name}@1.8.3`] } }))
  writeFileSync(join(installed, 'package.json'), JSON.stringify({ name, version: '1.8.3', bin: { 'judicial-mcp': 'dist/judicial-mcp.mjs' } }))
  writeFileSync(join(installed, 'dist/judicial-mcp.mjs'), 'process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,result:{env:process.env}})+"\\n")')
  cpSync(dirname(dirname(require.resolve('dotenv'))), join(runtime, 'node_modules/dotenv'), { recursive: true })
  const envFile = join(home, 'credentials.env')
  writeFileSync(envFile, 'JUDICIAL_USERNAME=fixture-user\nJUDICIAL_PASSWORD="literal$()# password"\nUNRELATED_SECRET=hidden\n')
  const run = (extra: Record<string, string> = {}) => spawnSync('bun', ['--no-env-file', launcher], { cwd: home, env: { HOME: home, PATH: process.env.PATH, JUDICIAL_ENV_FILE: envFile, FIRECRAWL_API_URL: 'http://127.0.0.1:3002', PARENT_SECRET: 'parent-hidden', JUDICIAL_USER: 'stale-user', JUDICIAL_PASSWORD: 'stale-secret', ...extra }, encoding: 'utf8', timeout: 5000 })
  return { home, runtime, installed, envFile, run }
}
it('loads only the approved credentials as literal dotenv values and preserves source and protocol stdout', () => {
  const f = fixture()
  const before = readFileSync(f.envFile)
  writeFileSync(join(f.runtime, '.env'), 'JUDICIAL_PASSWORD=unexpected\nEXTRA_SECRET=hidden\n')
  const result = f.run()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  const message = JSON.parse(result.stdout)
  expect(message.jsonrpc).toBe('2.0')
  expect(message.result.env).toMatchObject({ JUDICIAL_USER: 'fixture-user', JUDICIAL_PASSWORD: 'literal$()# password', FIRECRAWL_API_URL: 'http://127.0.0.1:3002', DOTENV_CONFIG_PATH: '/dev/null' })
  for (const key of ['UNRELATED_SECRET', 'PARENT_SECRET', 'EXTRA_SECRET', 'JUDICIAL_USERNAME', 'JUDICIAL_ENV_FILE']) expect(message.result.env).not.toHaveProperty(key)
  expect(readFileSync(f.envFile)).toEqual(before)
})
it.each(['package.json', 'bun.lock', 'node_modules/@jurislm/judicial-mcp/dist/judicial-mcp.mjs'])('fails closed without %s', file => {
  const f = fixture()
  rmSync(join(f.runtime, file))
  const result = f.run()
  expect(result.status).not.toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).not.toContain('fixture-user')
  expect(result.stderr).not.toContain('literal$')
})
it.each(['', 'JUDICIAL_USERNAME=user\n', 'JUDICIAL_USERNAME=user\nJUDICIAL_PASSWORD=\n'])('rejects empty or missing credentials without leaking input', content => {
  const f = fixture()
  writeFileSync(f.envFile, content)
  const result = f.run()
  expect(result.status).not.toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).not.toContain('stale-secret')
})
it('rejects a missing explicit environment file', () => {
  const f = fixture()
  const result = f.run({ JUDICIAL_ENV_FILE: join(f.home, 'absent') })
  expect(result.status).not.toBe(0)
  expect(result.stdout).toBe('')
})
it('rejects a floating or mismatched installed version', () => {
  const f = fixture()
  writeFileSync(join(f.runtime, 'package.json'), JSON.stringify({ dependencies: { [name]: 'latest' } }))
  expect(f.run().status).not.toBe(0)
  writeFileSync(join(f.runtime, 'package.json'), JSON.stringify({ dependencies: { [name]: '1.8.4' } }))
  expect(f.run().status).not.toBe(0)
})
it('accepts the canonical username but rejects conflicting aliases', () => {
  const f = fixture()
  writeFileSync(f.envFile, 'JUDICIAL_USER=canonical\nJUDICIAL_PASSWORD=literal\n')
  expect(JSON.parse(f.run().stdout).result.env.JUDICIAL_USER).toBe('canonical')
  writeFileSync(f.envFile, 'JUDICIAL_USER=canonical\nJUDICIAL_USERNAME=other\nJUDICIAL_PASSWORD=literal\n')
  expect(f.run().status).not.toBe(0)
})
it('rejects lock drift and missing parser dependencies before starting the server', () => {
  const f = fixture()
  const lock = readFileSync(join(f.runtime, 'bun.lock'))
  writeFileSync(join(f.runtime, 'bun.lock'), '{}')
  expect(f.run().status).not.toBe(0)
  writeFileSync(join(f.runtime, 'bun.lock'), lock)
  rmSync(join(f.runtime, 'node_modules/dotenv'), { recursive: true })
  expect(f.run().status).not.toBe(0)
})

it('includes the desktop launcher in the published package', () => {
  const output = mkdtempSync(join(tmpdir(), 'judicial-desktop-pack-'))
  roots.push(output)
  const [{ filename }] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', output, '--json'], { encoding: 'utf8' }))
  const packed = execFileSync('tar', ['-xOf', join(output, filename), 'package/launchers/judicial-desktop.mjs'], { encoding: 'utf8' })
  expect(packed).toBe(readFileSync(launcher, 'utf8'))
})

it('resolves dotenv from the installed package when dependencies are not hoisted', () => {
  const f = fixture()
  mkdirSync(join(f.installed, 'node_modules'), { recursive: true })
  renameSync(join(f.runtime, 'node_modules/dotenv'), join(f.installed, 'node_modules/dotenv'))
  const result = f.run()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  expect(JSON.parse(result.stdout).result.env.JUDICIAL_USER).toBe('fixture-user')
})

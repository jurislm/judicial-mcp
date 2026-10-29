import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { expect, it } from 'vitest'

it('packed CLI initializes and lists every tool without source or dependencies', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'judicial-runtime-'))
  try {
    execFileSync('bun', ['run', 'build:runtime'], { stdio: 'pipe' })
    const archive = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', temporary, '--json'], { encoding: 'utf8' })
    const [{ filename }] = JSON.parse(archive)
    execFileSync('tar', ['-xzf', join(temporary, filename), '-C', temporary])
    const packed = join(temporary, 'package')
    const pkg = JSON.parse(readFileSync(join(packed, 'package.json'), 'utf8'))
    rmSync(join(packed, 'src'), { recursive: true, force: true })
    rmSync(join(packed, 'node_modules'), { recursive: true, force: true })
    const responses = await new Promise<string[]>((resolve, reject) => {
      const child = spawn('bun', [join(packed, pkg.bin['judicial-mcp'])], {
        cwd: temporary,
        env: { PATH: process.env.PATH, HOME: temporary },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const lines: string[] = []
      const output = createInterface({ input: child.stdout })
      let stderr = ''
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Runtime timed out: ${stderr}`)) }, 15000)
      child.stderr.on('data', chunk => { stderr += chunk })
      output.on('line', line => {
        lines.push(line)
        if (lines.length >= 2) {
          clearTimeout(timer)
          output.close()
          child.kill()
          resolve(lines)
        }
      })
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('exit', code => {
        clearTimeout(timer)
        if (lines.length < 2) reject(new Error(`Runtime exited ${code}: ${stderr}`))
      })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pack-test', version: '1' } } }) + '\n')
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n')
    })
    const messages = responses.map(line => JSON.parse(line))
    expect(messages.every(message => message.jsonrpc === '2.0')).toBe(true)
    expect(messages.find(message => message.id === 1).result.serverInfo.version).toBe(pkg.version)
    const tools = messages.find(message => message.id === 2).result.tools
    expect(tools).toHaveLength(10)
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining(['search_judgments', 'fetch_judgment_text', 'query_regulation']))
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}, 30000)

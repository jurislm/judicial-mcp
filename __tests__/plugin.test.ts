import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

function json(path: string): unknown {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
}

describe('Codex plugin package', () => {
  it('provides portable and compatibility identities synchronized with npm', () => {
    const pkg = json('package.json')
    const portable = json('plugin.json')
    const compatibility = json('.codex-plugin/plugin.json')
    expect(pkg).toHaveProperty('version')
    if (!pkg || typeof pkg !== 'object' || !('version' in pkg)) throw new Error('Missing npm version')
    expect(portable).toMatchObject({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'judicial-mcp', version: pkg.version,
      extensions: { 'com.openai': { requires_local_executor: true, interface: { displayName: 'Judicial MCP', capabilities: ['Read'] } } },
    })
    expect(compatibility).toMatchObject({ name: 'judicial-mcp', version: pkg.version, mcpServers: './.mcp.json', requires_local_executor: true })
  })

  it('uses the same bundled npm CLI in portable and Codex MCP declarations', () => {
    expect(json('mcp.json')).toMatchObject({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: { judicial: { type: 'stdio', command: 'bun', args: ['x', '@jurislm/judicial-mcp@latest'] } },
    })
    expect(json('.mcp.json')).toMatchObject({ mcpServers: { judicial: {
      type: 'stdio', command: 'bun', args: ['x', '@jurislm/judicial-mcp@latest'],
      env_vars: ['FIRECRAWL_API_URL', 'FIRECRAWL_API_KEY', 'JUDICIAL_USER', 'JUDICIAL_PASSWORD'],
    } } })
  })

  it('offers only this repo plugin from its marketplace without forcing installation', () => {
    expect(json('.agents/plugins/marketplace.json')).toEqual({
      name: 'judicial-marketplace', interface: { displayName: 'Judicial MCP' },
      plugins: [{ name: 'judicial-mcp', source: { source: 'local', path: './' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
    })
  })
})

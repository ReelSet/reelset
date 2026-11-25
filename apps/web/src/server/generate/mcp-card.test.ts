import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'
import { buildMcpServerCard } from './mcp-card'
import { MCP_SERVER_VERSION, TOOL_DESCRIPTIONS, TOOL_TITLES } from './mcp-tools'

describe('buildMcpServerCard', () => {
  const card = buildMcpServerCard()

  it('describes the server, transport and bearer auth', () => {
    expect(card.$schema).toBe(
      'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
    )
    expect(card.version).toBe('1.0')
    expect(card.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
    expect(card.serverInfo).toEqual({
      name: 'reelset',
      title: 'Reelset',
      version: MCP_SERVER_VERSION,
    })
    expect(card.transport).toEqual({
      type: 'streamable-http',
      endpoint: 'https://reelset.app/api/mcp',
    })
    expect(card.capabilities).toEqual({ tools: {} })
    expect(card.authentication).toEqual({
      required: true,
      schemes: ['bearer'],
      documentation: 'https://reelset.app/auth.md',
    })
    expect(card.documentation).toBe('https://reelset.app/mcp')
    expect(card.description).toContain('developer reels')
  })

  it('lists every tool with the title and description the server registers', () => {
    expect(card.tools.map((t) => t.name)).toEqual(Object.keys(TOOL_DESCRIPTIONS))
    for (const tool of card.tools) {
      const name = tool.name as keyof typeof TOOL_DESCRIPTIONS
      expect(tool.title).toBe(TOOL_TITLES[name])
      expect(tool.description).toBe(TOOL_DESCRIPTIONS[name])
    }
  })
})

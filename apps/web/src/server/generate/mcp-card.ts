import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { absoluteUrl } from '@/lib/seo/site'
import { MCP_SERVER_VERSION, TOOL_DESCRIPTIONS, TOOL_TITLES } from './mcp-tools'

export type McpServerCard = {
  $schema: string
  version: string
  protocolVersion: string
  serverInfo: { name: string; title: string; version: string }
  description: string
  documentation: string
  transport: { type: 'streamable-http'; endpoint: string }
  capabilities: { tools: Record<string, never> }
  authentication: { required: boolean; schemes: string[]; documentation: string }
  tools: { name: string; title: string; description: string }[]
}

export function buildMcpServerCard(): McpServerCard {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
    version: '1.0',
    protocolVersion: LATEST_PROTOCOL_VERSION,
    serverInfo: { name: 'reelset', title: 'Reelset', version: MCP_SERVER_VERSION },
    description:
      'Turn public links into 60-second developer reels, check their status, publish them to the Reelset feed and read your credits.',
    documentation: absoluteUrl('/mcp'),
    transport: { type: 'streamable-http', endpoint: absoluteUrl('/api/mcp') },
    capabilities: { tools: {} },
    authentication: {
      required: true,
      schemes: ['bearer'],
      documentation: absoluteUrl('/auth.md'),
    },
    tools: (Object.keys(TOOL_DESCRIPTIONS) as (keyof typeof TOOL_DESCRIPTIONS)[]).map((name) => ({
      name,
      title: TOOL_TITLES[name],
      description: TOOL_DESCRIPTIONS[name],
    })),
  }
}

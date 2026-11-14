import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { MAX_URLS_PER_REQUEST } from '@/lib/generate/types'
import {
  TOOL_DESCRIPTIONS,
  generateReelTool,
  getCreditsTool,
  getReelStatusTool,
  listMyReelsTool,
  type McpContext,
} from './mcp-tools'

export function createReelsetMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: 'reelset', version: '1.0.0' })
  server.registerTool(
    'generate_reel',
    {
      title: 'Generate a reel',
      description: TOOL_DESCRIPTIONS.generate_reel,
      inputSchema: {
        urls: z
          .array(z.string().url())
          .min(1)
          .max(MAX_URLS_PER_REQUEST)
          .describe('Public http(s) links to turn into one reel'),
      },
    },
    (args) => generateReelTool(ctx, args),
  )
  server.registerTool(
    'get_reel_status',
    {
      title: 'Get reel status',
      description: TOOL_DESCRIPTIONS.get_reel_status,
      inputSchema: { request_id: z.string().describe('The request_id from generate_reel') },
      annotations: { readOnlyHint: true },
    },
    (args) => getReelStatusTool(ctx, args),
  )
  server.registerTool(
    'list_my_reels',
    {
      title: 'List my reels',
      description: TOOL_DESCRIPTIONS.list_my_reels,
      inputSchema: { limit: z.number().int().min(1).max(20).optional() },
      annotations: { readOnlyHint: true },
    },
    (args) => listMyReelsTool(ctx, args),
  )
  server.registerTool(
    'get_credits',
    {
      title: 'Get credits',
      description: TOOL_DESCRIPTIONS.get_credits,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => getCreditsTool(ctx),
  )
  return server
}

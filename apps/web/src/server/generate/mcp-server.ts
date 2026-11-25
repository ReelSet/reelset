import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker'
import { z } from 'zod'
import { MAX_URLS_PER_REQUEST } from '@/lib/generate/types'
import {
  MCP_SERVER_VERSION,
  TOOL_DESCRIPTIONS,
  TOOL_TITLES,
  generateReelTool,
  getCreditsTool,
  getReelStatusTool,
  listMyReelsTool,
  publishReelTool,
  type McpContext,
} from './mcp-tools'

export function createReelsetMcpServer(ctx: McpContext): McpServer {
  // AJV compiles validators with new Function, which Workers forbid.
  const server = new McpServer(
    { name: 'reelset', version: MCP_SERVER_VERSION },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  )
  server.registerTool(
    'generate_reel',
    {
      title: TOOL_TITLES.generate_reel,
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
      title: TOOL_TITLES.get_reel_status,
      description: TOOL_DESCRIPTIONS.get_reel_status,
      inputSchema: { request_id: z.string().describe('The request_id from generate_reel') },
      annotations: { readOnlyHint: true },
    },
    (args) => getReelStatusTool(ctx, args),
  )
  server.registerTool(
    'list_my_reels',
    {
      title: TOOL_TITLES.list_my_reels,
      description: TOOL_DESCRIPTIONS.list_my_reels,
      inputSchema: { limit: z.number().int().min(1).max(20).optional() },
      annotations: { readOnlyHint: true },
    },
    (args) => listMyReelsTool(ctx, args),
  )
  server.registerTool(
    'publish_reel',
    {
      title: TOOL_TITLES.publish_reel,
      description: TOOL_DESCRIPTIONS.publish_reel,
      inputSchema: { request_id: z.string().describe('The request_id of a finished reel') },
    },
    (args) => publishReelTool(ctx, args),
  )
  server.registerTool(
    'get_credits',
    {
      title: TOOL_TITLES.get_credits,
      description: TOOL_DESCRIPTIONS.get_credits,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => getCreditsTool(ctx),
  )
  return server
}

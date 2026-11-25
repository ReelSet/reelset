import type { Database, Logger } from '@reelset/core'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { CreditsDto, ReelRequestDto } from '@/lib/generate/types'
import { MAX_URLS_PER_REQUEST } from '@/lib/generate/types'
import { submitToFeed } from './publish'
import { createGenerateRequest, getCredits, getRequestForViewer, listMyRequests } from './service'
import type { Viewer } from './service'

export type McpContext = { db: Database; user: Viewer; log: Logger }

type Structured = Record<string, unknown>

function reelFields(request: ReelRequestDto): Structured {
  const active = request.steps.find((s) => s.state === 'active' || s.state === 'failed')
  return {
    request_id: request.id,
    status: request.status,
    current_step: active?.label ?? (request.status === 'done' ? 'Ready' : null),
    steps: request.steps.map((s) => ({ key: s.key, label: s.label, state: s.state })),
    ahead_of_you: request.aheadOfYou,
    error: request.error,
    title: request.reel?.title ?? null,
    video_url: request.reel?.videoUrl ?? null,
    download_url: request.reel?.downloadUrl ?? null,
    poster_url: request.reel?.posterUrl ?? null,
    page_url: request.reel?.pageUrl ?? null,
    feed_status: request.reel?.publish.state ?? null,
    feed_note: request.reel?.publish.note ?? null,
    duration_ms: request.reel?.durationMs ?? null,
    sources: request.urls,
  }
}

export function describeRequest(request: ReelRequestDto): string {
  const id = request.id
  if (request.status === 'done') {
    const reel = request.reel
    return [
      `Reel ready (request ${id}).`,
      reel?.title ? `Title: ${reel.title}` : null,
      reel?.videoUrl ? `Video (MP4): ${reel.videoUrl}` : null,
      reel?.pageUrl ? `Page: ${reel.pageUrl}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  }
  if (request.status === 'failed') {
    return `Request ${id} failed: ${request.error ?? 'unknown error'} Credits were refunded.`
  }
  const active = request.steps.find((s) => s.state === 'active')
  const ahead = request.aheadOfYou ? ` ${request.aheadOfYou} ahead of it in the queue.` : ''
  return `Request ${id} is in progress: ${active?.label ?? 'Queued'}.${ahead} Check again with get_reel_status in about 30 seconds.`
}

function ok(text: string, structured: Structured): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured }
}

function fail(text: string, structured: Structured = {}): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }], structuredContent: structured }
}

function creditsLeft(credits: CreditsDto): number | 'unlimited' {
  return credits.unlimited ? 'unlimited' : credits.balance
}

export async function generateReelTool(
  ctx: McpContext,
  args: { urls: string[] },
): Promise<CallToolResult> {
  const result = await createGenerateRequest(
    ctx.db,
    { user: ctx.user, urls: args.urls, via: 'mcp' },
    ctx.log,
  )
  if (!result.ok) return fail(result.message, { error: result.error })
  const left = creditsLeft(result.credits)
  return ok(
    `${describeRequest(result.request)}\nCredits left this month: ${left} (${result.credits.cost} per reel).`,
    { ...reelFields(result.request), credits_left: left },
  )
}

export async function getReelStatusTool(
  ctx: McpContext,
  args: { request_id: string },
): Promise<CallToolResult> {
  const request = await getRequestForViewer(ctx.db, args.request_id, ctx.user, ctx.log)
  if (!request)
    return fail(`No reel request found with id ${args.request_id}.`, { error: 'not_found' })
  const credits = await getCredits(ctx.db, ctx.user, ctx.log)
  return ok(describeRequest(request), {
    ...reelFields(request),
    credits_left: creditsLeft(credits),
  })
}

export async function listMyReelsTool(
  ctx: McpContext,
  args: { limit?: number },
): Promise<CallToolResult> {
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 10), 1), 20)
  const requests = await listMyRequests(ctx.db, ctx.user.id, limit, ctx.log)
  const text =
    requests.length === 0
      ? 'No reels yet. Use generate_reel to make one.'
      : requests
          .map((r) => {
            const label = r.reel?.title ?? r.urls[0] ?? r.id
            return `- ${r.id} [${r.status}] ${label}${r.reel?.pageUrl && r.status === 'done' ? ` ${r.reel.pageUrl}` : ''}`
          })
          .join('\n')
  return ok(text, { reels: requests.map(reelFields), count: requests.length })
}

export async function publishReelTool(
  ctx: McpContext,
  args: { request_id: string },
): Promise<CallToolResult> {
  const result = await submitToFeed(
    ctx.db,
    { viewer: ctx.user, requestId: args.request_id },
    ctx.log,
  )
  if (!result.ok) return fail(result.message, { error: result.error })
  return ok(
    `Submitted request ${args.request_id} for review. It appears in the public feed once approved.`,
    reelFields(result.request),
  )
}

export async function getCreditsTool(ctx: McpContext): Promise<CallToolResult> {
  const credits = await getCredits(ctx.db, ctx.user, ctx.log)
  const left = creditsLeft(credits)
  const text = credits.unlimited
    ? 'Unlimited credits (admin).'
    : `${credits.balance} credits left this month, enough for ${credits.reelsLeft} reels (${credits.cost} each). Resets ${credits.resetsAt.slice(0, 10)}.`
  return ok(text, {
    credits_left: left,
    monthly_free: credits.monthlyFree,
    cost_per_reel: credits.cost,
    reels_left: credits.reelsLeft,
    resets_at: credits.resetsAt,
  })
}

export const MCP_SERVER_VERSION = '1.0.0'

export const TOOL_DESCRIPTIONS = {
  generate_reel: `Turn up to ${MAX_URLS_PER_REQUEST} links into one short vertical video reel (about 60 seconds, narrated, with captions) hosted on reelset. Accepts GitHub repos, Hacker News and Reddit threads, YouTube videos, arXiv papers and any news or blog article. Several links become ONE reel that combines them. Rendering takes a few minutes: this returns a request_id immediately, then call get_reel_status until status is "done" to get the MP4 and a shareable page. Costs 100 credits per reel (1,000 free every month). If the links were already turned into a reel it returns that reel instantly for free.`,
  get_reel_status:
    'Check progress of a reel made with generate_reel. Returns the status (pending, resolving, processing, done, failed), the pipeline steps (Queued, Reading sources, Writing script, Voice & render, Ready), your place in the queue, and when done the video_url (MP4), poster_url and page_url. Poll about every 30 seconds.',
  list_my_reels:
    'List your most recent reel requests with their status and links, newest first. Use it to find an earlier request_id or to share a finished reel.',
  publish_reel:
    'Submit a finished reel (made with generate_reel) for review so it can appear in the public reelset feed. Reels are private until approved. Returns feed_status "in_review"; check get_reel_status later for "live" or "rejected" (with feed_note). Only reels you made, with status "done", can be submitted.',
  get_credits:
    'Show how many reelset credits you have left this month, how many reels that covers, and when the balance resets.',
} as const

export const TOOL_TITLES: Record<keyof typeof TOOL_DESCRIPTIONS, string> = {
  generate_reel: 'Generate a reel',
  get_reel_status: 'Get reel status',
  list_my_reels: 'List my reels',
  publish_reel: 'Submit a reel to the feed',
  get_credits: 'Get credits',
}

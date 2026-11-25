import { absoluteUrl } from './site'

export const API_CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'

type LinkTarget = { href: string; type: string }
type LinksetEntry = {
  anchor: string
  'service-desc': LinkTarget[]
  'service-doc': LinkTarget[]
}

export function buildApiCatalog(): { linkset: LinksetEntry[] } {
  return {
    linkset: [
      {
        anchor: absoluteUrl('/api/mcp'),
        'service-desc': [
          { href: absoluteUrl('/.well-known/mcp/server-card.json'), type: 'application/json' },
        ],
        'service-doc': [
          { href: absoluteUrl('/mcp'), type: 'text/html' },
          { href: absoluteUrl('/auth.md'), type: 'text/markdown' },
        ],
      },
    ],
  }
}

export const AUTH_MD = `# Reelset auth.md

How AI agents and scripts get access to Reelset on behalf of a Reelset user.

## Who this is for

Agents that call the Reelset MCP server to make reels from links, check their status, publish them to the feed or read credits. Reading reels needs no auth: every reel page, /llms.txt and the markdown versions (/index.md, /r/<reel>.md) are public.

## Getting a credential

There is no self-registration and no OAuth for agents. A human Reelset user signs in at ${absoluteUrl('/login')}, opens ${absoluteUrl('/profile')} and creates an API key. Keys look like \`rs_live_...\` and are shown once.

## Using it

Send the key on every request to the MCP server (Streamable HTTP, JSON-RPC over POST):
\`Authorization: Bearer rs_live_...\`
Endpoint: ${absoluteUrl('/api/mcp')}
Server card: ${absoluteUrl('/.well-known/mcp/server-card.json')}
Setup guide: ${absoluteUrl('/mcp')}

A missing or revoked key gets HTTP 401 with a \`WWW-Authenticate: Bearer\` challenge. Generating a reel spends the user's credits; \`get_credits\` shows the balance.

## Revoking

The user revokes the key on ${absoluteUrl('/profile')}. It stops working right away.
`

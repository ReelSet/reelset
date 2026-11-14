'use client'

import { useState } from 'react'
import { CopyButton } from '@/components/generate/CopyButton'
import { ApiKeys } from '@/components/profile/ApiKeys'

const URL_MCP = 'https://reelset.app/api/mcp'

type Client = { id: string; label: string; file: string; code: (key: string) => string }

const CLIENTS: Client[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    file: 'Run in your terminal',
    code: (k) =>
      `claude mcp add --transport http reelset ${URL_MCP} --header "Authorization: Bearer ${k}"`,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    file: '.cursor/mcp.json',
    code: (k) =>
      JSON.stringify(
        { mcpServers: { reelset: { url: URL_MCP, headers: { Authorization: `Bearer ${k}` } } } },
        null,
        2,
      ),
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    file: 'claude_desktop_config.json',
    code: (k) =>
      JSON.stringify(
        {
          mcpServers: {
            reelset: {
              command: 'npx',
              args: ['-y', 'mcp-remote', URL_MCP, '--header', 'Authorization:${REELSET_AUTH}'],
              env: { REELSET_AUTH: `Bearer ${k}` },
            },
          },
        },
        null,
        2,
      ),
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    file: '~/.codeium/windsurf/mcp_config.json',
    code: (k) =>
      JSON.stringify(
        {
          mcpServers: {
            reelset: { serverUrl: URL_MCP, headers: { Authorization: `Bearer ${k}` } },
          },
        },
        null,
        2,
      ),
  },
]

export function McpConnect({ signedIn }: { signedIn: boolean }) {
  const [active, setActive] = useState('claude-code')
  const [token, setToken] = useState<string | null>(null)
  const client = CLIENTS.find((c) => c.id === active) ?? CLIENTS[0]!
  const code = client.code(token ?? 'YOUR_KEY')

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h3 className="text-[15px] font-semibold">
          <span className="mr-2 text-accent">1</span>Create an API key
        </h3>
        <div className="mt-3">
          {signedIn ? (
            <ApiKeys onToken={setToken} />
          ) : (
            <a
              href="/login?next=/mcp"
              className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition active:scale-95"
            >
              Sign in to create a key
            </a>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-[15px] font-semibold">
          <span className="mr-2 text-accent">2</span>Add Reelset to your client
        </h3>
        <div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface">
          <div
            role="tablist"
            aria-label="MCP client"
            className="no-scrollbar flex overflow-x-auto border-b border-line"
          >
            {CLIENTS.map((c) => (
              <button
                key={c.id}
                role="tab"
                type="button"
                id={`tab-${c.id}`}
                aria-selected={active === c.id}
                aria-controls="mcp-panel"
                onClick={() => setActive(c.id)}
                className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-[13px] font-medium transition ${
                  active === c.id
                    ? 'border-accent text-fg'
                    : 'border-transparent text-faint hover:text-fg'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div id="mcp-panel" role="tabpanel" aria-labelledby={`tab-${client.id}`} className="p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs text-faint">{client.file}</span>
              <CopyButton text={code} label="Copy" />
            </div>
            <pre className="overflow-x-auto rounded-md bg-bg p-3.5 font-mono text-xs leading-relaxed text-fg/90">
              <code>{code}</code>
            </pre>
            {!token && (
              <p className="mt-2 text-xs text-faint">
                Replace <code className="text-muted">YOUR_KEY</code> with the key from step 1.
              </p>
            )}
            {token && (
              <p className="mt-2 text-xs text-ok">Your new key is already filled in above.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

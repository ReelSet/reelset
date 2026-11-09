const FIELD_SEPARATOR = '\u001f'

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function contentHash(parts: readonly string[]): Promise<string> {
  return sha256Hex(parts.join(FIELD_SEPARATOR))
}

export type RenderKeyInput = {
  itemId: string
  contentHash: string
  promptVersion: string
  templateVersion: string
  voice: string
}

export async function renderKey(input: RenderKeyInput): Promise<string> {
  const fields = [
    input.itemId,
    input.contentHash,
    input.promptVersion,
    input.templateVersion,
    input.voice,
  ]
  const missing = fields.findIndex((field) => field.trim() === '')
  if (missing !== -1) {
    throw new Error(`renderKey: field ${Object.keys(input)[missing]} is empty`)
  }
  return sha256Hex(fields.join(FIELD_SEPARATOR))
}

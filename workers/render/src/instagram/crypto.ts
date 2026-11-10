const VERSION = 'v1'
const IV_BYTES = 12

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function unb64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

export async function importSessionKey(base64Key: string): Promise<CryptoKey> {
  const raw = unb64(base64Key.trim())
  if (raw.length !== 32) throw new Error('IG_SESSION_KEY must be 32 bytes, base64 encoded')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plain = new TextEncoder().encode(JSON.stringify(value))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  return `${VERSION}.${b64(iv)}.${b64(cipher)}`
}

export async function decryptJson(key: CryptoKey, blob: string): Promise<unknown> {
  const [version, iv, cipher] = blob.split('.')
  if (version !== VERSION || !iv || !cipher) throw new Error('unsupported session blob')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(cipher))
  return JSON.parse(new TextDecoder().decode(plain))
}

const encoder = new TextEncoder()

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

// Hashing both sides first makes the comparison length-independent and constant-time in content.
export async function isAuthorized(request: Request, token: string | undefined): Promise<boolean> {
  if (!token || token.length < 32) return false
  const header = request.headers.get('authorization') ?? ''
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : ''
  const [a, b] = await Promise.all([digest(supplied), digest(token)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

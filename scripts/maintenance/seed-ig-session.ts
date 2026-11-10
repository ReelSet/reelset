import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createDb, createLogger, setEncryptedSession } from '@reelset/core'
import { encryptJson, importSessionKey } from '../../workers/render/src/instagram/crypto'

// Seeds the encrypted Instagram session from the local instagrapi file so the server skips a fresh login.
const sessionPath = process.env.IG_SESSION_PATH ?? `${homedir()}/.reelset/ig_session.json`
const keyB64 = process.env.IG_SESSION_KEY
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!keyB64) throw new Error('IG_SESSION_KEY must be set')
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const log = createLogger({ app: 'maintenance', level: 'info' })
const session: unknown = JSON.parse(readFileSync(sessionPath, 'utf8'))
if (typeof session !== 'object' || session === null)
  throw new Error('session file is not an object')

const blob = await encryptJson(await importSessionKey(keyB64), { session, proxyIndex: null })
const { db, close } = createDb({ connectionString, log, max: 1 })
try {
  await setEncryptedSession(db, blob)
  log.info({ keys: Object.keys(session).length }, 'instagram session seeded (encrypted)')
} finally {
  await close()
}

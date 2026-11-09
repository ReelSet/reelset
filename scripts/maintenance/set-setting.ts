import { createDb, createLogger, getSetting, setSetting, SETTINGS } from '@reelset/core'

const [name, raw] = process.argv.slice(2)
const def = SETTINGS[name as keyof typeof SETTINGS]
if (!def || raw === undefined) throw new Error('usage: set-setting <settingName> <jsonValue>')
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const log = createLogger({ app: 'maintenance', level: 'warn' })
const { db, close } = createDb({ connectionString, log, max: 1 })
try {
  await setSetting(db, def, JSON.parse(raw), log)
  console.log(name, '=', await getSetting(db, def, log))
} finally {
  await close()
}

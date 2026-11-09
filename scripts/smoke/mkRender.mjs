import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DIRECT_URL }); await c.connect()
const r = (await c.query(`select id,title,script from item where id::text like '1d1dcc0a%'`)).rows[0]
await c.end()
const s = r.script
console.error(JSON.stringify({beats: s.beats.map(b=>b.visual.type), hook: s.hook.length}))
console.log(JSON.stringify({ jobId: 'smoke-' + r.id, script: { hook: s.hook, beats: s.beats, outro: s.outro }, title: r.title.slice(0, 200), sourceLabel: 'HN', imageUrls: [], voice: 'en-US-AriaNeural' }))

import {
  generateNarration,
  wordsToJson,
  audioToBase64,
  type AiLike,
} from '../../../workers/render/src/tts'

const log = {
  info: (o: unknown, m?: string) => console.log(m, JSON.stringify(o)),
  warn: (o: unknown, m?: string) => console.warn(m, JSON.stringify(o)),
  error: (o: unknown, m?: string) => console.error(m, JSON.stringify(o)),
} as never

export default {
  async fetch(request: Request, env: { AI: AiLike }): Promise<Response> {
    const { text, speaker } = (await request.json()) as { text: string; speaker: string }
    let narration
    try {
      narration = await generateNarration(env.AI, text, speaker, log)
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
    return Response.json({
      audioBase64: audioToBase64(narration.audio),
      words: wordsToJson(narration.words),
      chars: narration.chars,
      audioSeconds: narration.audioSeconds,
      costUsd: narration.costUsd,
      alignment: narration.alignment,
      transcript: narration.spoken.map((w) => w.word).join(' '),
    })
  },
}

export const QUESTION_MIN_LENGTH = 3
export const QUESTION_MAX_LENGTH = 300

export function normalizeQuestion(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?!.\s]+$/u, '')
}

export type QuestionCheck =
  | { ok: true; question: string; normalized: string }
  | { ok: false; reason: 'not_a_string' | 'too_short' | 'too_long' }

export function validateQuestion(raw: unknown): QuestionCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'not_a_string' }
  const question = raw.replace(/\s+/g, ' ').trim()
  if (question.length > QUESTION_MAX_LENGTH) return { ok: false, reason: 'too_long' }
  const normalized = normalizeQuestion(question)
  if (question.length < QUESTION_MIN_LENGTH || normalized.length < QUESTION_MIN_LENGTH) {
    return { ok: false, reason: 'too_short' }
  }
  return { ok: true, question, normalized }
}

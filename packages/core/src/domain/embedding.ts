export const EMBEDDING_DIMENSIONS = 768

export class EmbeddingShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmbeddingShapeError'
  }
}

export function toVectorLiteral(values: readonly number[]): string {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingShapeError(
      `expected ${EMBEDDING_DIMENSIONS} dimensions, got ${values.length}`,
    )
  }
  const bad = values.findIndex((v) => !Number.isFinite(v))
  if (bad !== -1) throw new EmbeddingShapeError(`non-finite value at index ${bad}`)
  return `[${values.join(',')}]`
}

export function fromVectorLiteral(text: string): number[] {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new EmbeddingShapeError('vector literal must be wrapped in [ ]')
  }
  const values = trimmed.slice(1, -1).split(',').map(Number)
  if (values.length !== EMBEDDING_DIMENSIONS || values.some((v) => !Number.isFinite(v))) {
    throw new EmbeddingShapeError(`malformed vector literal (${values.length} values)`)
  }
  return values
}

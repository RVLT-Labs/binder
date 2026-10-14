/** Deep equality of JSON values: object key order is ignored, array order matters. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => jsonEqual(v, b[i]))
    )
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every((k) => k in y && jsonEqual(x[k], y[k]))
}

function parseStructured(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const t = v.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return v
  try {
    return JSON.parse(t)
  } catch {
    return v
  }
}

/** Compares column values where either side may be JSON text (a synced jsonb column) or a parsed value. */
export function columnEqual(a: unknown, b: unknown): boolean {
  return jsonEqual(parseStructured(a), parseStructured(b))
}

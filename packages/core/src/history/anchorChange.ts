import { jsonEqual } from '../json/jsonEqual'

type Obj = Record<string, unknown>

/** An anchor as the log holds it: an object, or its JSON text. Anything else is not an anchor. */
function asAnchor(value: unknown): Obj | null {
  let v = value
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null
}

/** A line or pointer mark sits at a character position, and its stored x follows that position. */
function isCaretMark(anchor: Obj): boolean {
  return anchor.mark === 'line' || anchor.mark === 'pointer'
}

/** An anchor with the parts a restyle changes taken out: the mark, the caret offset, and (for a caret mark) x. */
function withoutStyle(anchor: Obj, dropX: boolean): Obj {
  const { mark: _mark, text, x: _x, ...rest } = anchor
  const out: Obj = dropX ? rest : { ...rest, x: anchor.x }
  if (text && typeof text === 'object') {
    const { offset: _offset, ...plain } = text as Obj
    out.text = plain
  } else if (text !== undefined) {
    out.text = text
  }
  return out
}

/** An anchor with the bubble offset taken out. */
function withoutTag(anchor: Obj): Obj {
  const { tag: _tag, ...rest } = anchor
  return rest
}

/** The mark an anchor is drawn with; an absent mark is the underline. */
function markOf(anchor: Obj): unknown {
  return anchor.mark ?? 'underline'
}

/**
 * What an anchor change was, the one rule the activity feed and the per-cue history both read:
 *
 * - `bubble-moved` when only the bubble's offset (`tag`) was set, changed or removed: the anchors
 *   are equal once the tag is taken out of both.
 * - `restyled` when the two marks differ and nothing else but the caret offset changed (equal once
 *   the mark and the caret offset are removed, and x too when either side is a line or pointer,
 *   whose x follows its character offset).
 * - otherwise `moved`, which includes dragging a line's caret along its text (same mark, new offset).
 */
export function anchorChangeKind(
  before: unknown,
  after: unknown,
): 'restyled' | 'moved' | 'bubble-moved' {
  const a = asAnchor(before)
  const b = asAnchor(after)
  if (!a || !b) return 'moved'
  if (jsonEqual(withoutTag(a), withoutTag(b)) && !jsonEqual(a.tag ?? null, b.tag ?? null)) {
    return 'bubble-moved'
  }
  if (markOf(a) === markOf(b)) return 'moved'
  const dropX = isCaretMark(a) || isCaretMark(b)
  return jsonEqual(withoutStyle(a, dropX), withoutStyle(b, dropX)) ? 'restyled' : 'moved'
}

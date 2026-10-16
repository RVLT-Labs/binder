import { Circle, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import {
  ArrowIcon,
  CueTagIcon,
  HighlightIcon,
  NoteIcon,
  RectIcon,
  SelectIcon,
  StampIcon,
} from '@/components/icons'
import type { Tool } from './tools'

/** A tool's glyph: the mockup's icons and lucide's both take a class and a stroke width. */
type ToolIcon = ComponentType<{ className?: string; strokeWidth?: number }>

export interface ToolDef {
  tool: Tool
  /** The button's accessible name. */
  label: string
  /** The key that does it (DESIGN 10); the ellipse and line tools have none. */
  key?: string
  icon: ToolIcon
}

/**
 * The tools the strip offers, top to bottom: select, the cue tool, then the annotation tools
 * (which draw on the active layer). `c` places a cue at the pointer rather than choosing the tool,
 * which is why it is a shortcut of its own (see shortcuts.ts); the other keys choose their tool.
 * The mockup's seven come first in its order with its icons (select, cue, highlight, note, box,
 * arrow, stamp); the ellipse and line tools, which it does not draw, sit after the box.
 */
export const TOOL_DEFS: readonly ToolDef[] = [
  { tool: 'select', label: 'Select', key: 'v', icon: SelectIcon },
  { tool: 'cue', label: 'Cue tool', key: 'c', icon: CueTagIcon },
  { tool: 'highlight', label: 'Highlight tool', key: 'h', icon: HighlightIcon },
  { tool: 'note', label: 'Note tool', key: 'n', icon: NoteIcon },
  { tool: 'rect', label: 'Rect tool', key: 'r', icon: RectIcon },
  { tool: 'ellipse', label: 'Ellipse tool', icon: Circle },
  { tool: 'line', label: 'Line tool', icon: Minus },
  { tool: 'arrow', label: 'Arrow tool', key: 'a', icon: ArrowIcon },
  { tool: 'stamp', label: 'Stamp tool', key: 's', icon: StampIcon },
]

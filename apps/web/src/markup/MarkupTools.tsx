import {
  ArrowUpRight,
  Circle,
  Highlighter,
  type LucideIcon,
  MessageSquare,
  Minus,
  MousePointer2,
  Square,
  Stamp,
  Tag,
} from 'lucide-react'
import type { Tool } from './tools'

export interface ToolDef {
  tool: Tool
  /** The button's accessible name. */
  label: string
  /** The key that does it (DESIGN 10); the ellipse and line tools have none. */
  key?: string
  icon: LucideIcon
}

/**
 * The tools the strip offers, top to bottom: select, the cue tool, then the annotation tools
 * (which draw on the active layer). `c` places a cue at the pointer rather than choosing the tool,
 * which is why it is a shortcut of its own (see shortcuts.ts); the other keys choose their tool.
 */
export const TOOL_DEFS: readonly ToolDef[] = [
  { tool: 'select', label: 'Select', key: 'v', icon: MousePointer2 },
  { tool: 'cue', label: 'Cue tool', key: 'c', icon: Tag },
  { tool: 'highlight', label: 'Highlight tool', key: 'h', icon: Highlighter },
  { tool: 'note', label: 'Note tool', key: 'n', icon: MessageSquare },
  { tool: 'rect', label: 'Rect tool', key: 'r', icon: Square },
  { tool: 'ellipse', label: 'Ellipse tool', icon: Circle },
  { tool: 'line', label: 'Line tool', icon: Minus },
  { tool: 'arrow', label: 'Arrow tool', key: 'a', icon: ArrowUpRight },
  { tool: 'stamp', label: 'Stamp tool', key: 's', icon: Stamp },
]

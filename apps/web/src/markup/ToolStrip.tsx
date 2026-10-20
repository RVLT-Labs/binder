import type { CueMark, CueType } from '@binder/shared'
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'
import { SearchIcon } from '@/components/icons'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, focusRing } from '@/lib/utils'
import { useCloseMenuKeepingFocus } from '../viewer/PhoneBarMenu'
import { useMarkupSession } from './MarkupSession'
import { TOOL_DEFS } from './MarkupTools'
import { StampPicker } from './StampPicker'
import { setCueMark, setStamp, setTool, useTool } from './tools'
import { UndoRedoButtons } from './UndoRedoButtons'

// The mockup's `.tool`: 34 x 34, radius 9, a 17 px icon in `--muted`, at the desktop with a mouse.
// Below 1025 px (the mockup's tablet strip, `.mb-tt`, and the phone's inline one), and on any touch
// screen however wide (a coarse pointer: an iPad Pro in landscape), it is 44 x 44 with a 19 px icon.
// The active tool is a red fill with the sticker shadow.
const BUTTON = cn(
  'relative flex size-11 shrink-0 items-center justify-center rounded-[10px] text-muted pointer-fine:min-[1025px]:size-[34px] pointer-fine:min-[1025px]:rounded-[9px]',
  'transition-colors hover:bg-elev hover:text-ink active:translate-y-px',
  focusRing,
  'focus-visible:ring-offset-card',
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-muted',
  // The active tool is red (DESIGN 8): live state, never decoration.
  'aria-pressed:bg-red aria-pressed:text-primary-foreground aria-pressed:shadow-stk aria-pressed:hover:bg-red aria-pressed:hover:text-primary-foreground',
)
/** The glyph: 19 px, and 17 px in the desktop's 34 px button (a mouse, above 1024 px). */
const GLYPH = 'size-[19px] pointer-fine:min-[1025px]:size-[17px]'
const FIELD = cn(
  'h-9 rounded-[8px] border-2 border-line-2 bg-card px-2.5 font-sans text-[13px] text-ink',
  focusRing,
  'focus-visible:ring-offset-elev',
  'disabled:cursor-not-allowed disabled:opacity-45',
)

/** A key cap in the button's bottom-right corner: a hint, so a screen reader hears the name only. */
function KeyHint({ children }: { children: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-0.5 bottom-px font-mono text-[11px] leading-none text-current opacity-70 min-[1025px]:right-[2px]"
    >
      {children}
    </span>
  )
}

function Tip({
  label,
  keyHint,
  floating,
  children,
}: {
  label: string
  keyHint?: string
  /** Only the floating strip has tooltips: inline (touch) there is no hover, and a popover's first focus would open one. */
  floating: boolean
  children: ReactNode
}) {
  if (!floating) return children
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        {label}
        {keyHint && <Kbd>{keyHint}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Tool options that appear beside their tool while it is chosen (below it when the strip is inline).
 * Beside the strip it is fixed to the viewport, so a strip that scrolls on a short stage does not clip it.
 */
function Flyout({ floating, children }: { floating: boolean; children: ReactNode }) {
  const self = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    if (!floating) return
    const measure = () => {
      const tool = self.current?.parentElement?.getBoundingClientRect()
      const box = self.current?.getBoundingClientRect()
      if (!tool || !box) return
      // Beside its tool, but never off the viewport: a strip scrolled on a short screen leaves the
      // tool near an edge, and the flyout (centred on the tool) is kept 8 px inside it.
      const half = box.height / 2
      const top = Math.min(
        Math.max(tool.top + tool.height / 2, half + 8),
        Math.max(half + 8, window.innerHeight - half - 8),
      )
      const left = Math.max(8, Math.min(tool.right + 8, window.innerWidth - box.width - 8))
      setAt((was) => (was && was.top === top && was.left === left ? was : { top, left }))
    }
    measure()
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, true)
    }
  }, [floating])
  return (
    <div
      ref={self}
      className={cn(
        'z-20 rounded-[12px] border-2 border-line-2 bg-elev p-1.5 shadow-card',
        floating ? 'fixed -translate-y-1/2' : 'absolute top-full left-0 mt-1',
      )}
      style={floating && at ? at : undefined}
    >
      {children}
    </div>
  )
}

/**
 * The markup tools, as a column floating at the stage's left edge (DESIGN 6.2), or inline (the
 * phone's "More tools"): select, the cue tool and the annotation tools with their keys in the
 * corner and find in the document (undo and redo are in the top bar, snap to text in the status bar). The cue's type and the stamp it
 * places show beside their tool while it is chosen. Why a tool is off (an archived show, an old
 * version) is said on the stage and wired to the tool with `aria-describedby`.
 */
export function ToolStrip({ variant = 'floating' }: { variant?: 'floating' | 'inline' }) {
  const session = useMarkupSession()
  const { tool, cueType, cueMark, stamp } = useTool()
  const hintId = useId()
  const annotationHintId = useId()
  const floating = variant === 'floating'
  // Inline (the phone's menu), Find shuts the menu first so the box it opens keeps the cursor.
  const closeMenu = useCloseMenuKeepingFocus()
  const disabled = 'disabled' in session.cueTarget ? session.cueTarget.disabled : null
  const annotationDisabled =
    'disabled' in session.annotationTarget ? session.annotationTarget.disabled : null
  // One hint element serves both groups when the reason is the same (an archived show).
  const annotationHint = annotationDisabled === disabled ? hintId : annotationHintId
  // On a short stage with a mouse the strip's buttons shrink first (a 1280x640 window), then the strip
  // scrolls. (Under 1025 px only: the desktop's 34 px buttons already fit.) A touch screen never
  // shrinks them below 44 px: the strip scrolls instead.
  const BUTTON_CLASS = floating
    ? cn(
        BUTTON,
        'pointer-fine:max-[1024px]:[@media(max-height:760px)]:size-9 pointer-fine:max-[1024px]:[@media(max-height:640px)]:size-8',
      )
    : BUTTON

  function toolButton(def: (typeof TOOL_DEFS)[number]) {
    const { tool: t, label, key, icon: Icon } = def
    const off = t === 'select' ? null : t === 'cue' ? disabled : annotationDisabled
    const hint = t === 'cue' ? hintId : annotationHint
    const button = (
      <button
        type="button"
        aria-label={label}
        aria-pressed={t === 'select' ? tool === 'select' : tool === t && !off}
        aria-describedby={off ? hint : undefined}
        aria-keyshortcuts={key}
        disabled={off !== null}
        className={BUTTON_CLASS}
        onClick={() => setTool(t === 'select' || tool === t ? 'select' : t)}
      >
        <Icon className={GLYPH} />
        {key && <KeyHint>{key}</KeyHint>}
      </button>
    )
    return (
      <div key={t} className="relative">
        <Tip floating={floating} label={label} keyHint={key}>
          {button}
        </Tip>
        {t === 'cue' && tool === 'cue' && !off && (
          <Flyout floating={floating}>
            <select
              aria-label="Cue type"
              value={cueType}
              className={FIELD}
              onChange={(e) => setTool('cue', e.target.value as CueType)}
            >
              <option value="go">Go</option>
              <option value="standby">Standby</option>
              <option value="warn">Warn</option>
            </select>
            <select
              aria-label="Cue mark"
              value={cueMark}
              className={cn(FIELD, 'ml-1.5')}
              onChange={(e) => setCueMark(e.target.value as CueMark)}
            >
              <option value="underline">Underline</option>
              <option value="highlight">Highlight</option>
              <option value="line">Line</option>
              <option value="pointer">Line with pointer</option>
            </select>
          </Flyout>
        )}
        {t === 'stamp' && tool === 'stamp' && (
          <Flyout floating={floating}>
            <StampPicker
              stamps={session.stamps}
              value={stamp}
              onChange={setStamp}
              disabled={annotationDisabled !== null}
              className={FIELD}
            />
          </Flyout>
        )}
      </div>
    )
  }

  // `.tool-sep`: a 1 px rule with 2 px above and below and 4 px either side.
  const divider = (
    <hr
      className={cn(
        'shrink-0 border-0 bg-line',
        floating ? 'mx-1 my-0.5 h-px self-stretch' : 'mx-1 h-6 w-px',
      )}
    />
  )

  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={150}>
      <fieldset
        aria-label="Markup tools"
        className={cn(
          // `.tools`: the card fill, a 2 px outline, radius 12, padding 6, gap 4, at 12 / 18 on the stage
          'markup-tools m-0 flex min-w-0 items-center gap-1 rounded-[12px] border-2 border-line-2 bg-card p-1.5 shadow-card',
          floating
            ? 'absolute top-[18px] left-3 z-10 max-h-[calc(100%-2.25rem)] flex-col overflow-y-auto [scrollbar-width:none]'
            : 'flex-wrap',
        )}
      >
        {TOOL_DEFS.map(toolButton)}
        {divider}
        <Tip floating={floating} label="Find in document" keyHint="/">
          <button
            type="button"
            aria-label="Find in document"
            aria-keyshortcuts="/"
            className={BUTTON_CLASS}
            onClick={() => {
              closeMenu?.()
              session.viewer.current?.focusSearch()
            }}
          >
            <SearchIcon className={GLYPH} />
            <KeyHint>/</KeyHint>
          </button>
        </Tip>
        {/* Undo and redo are in the top bar (the mockup's); the phone's inline strip, which has no
            top bar room, keeps them. Snap to text is the status bar's (the phone's menu has it). */}
        {!floating && (
          <>
            {divider}
            <UndoRedoButtons strip={{ buttonClassName: BUTTON_CLASS, iconClassName: GLYPH }} />
          </>
        )}
      </fieldset>
      {(disabled || annotationDisabled) && (
        <div
          className={cn(
            floating
              ? 'pointer-events-none absolute top-3 left-1/2 z-10 flex max-w-[min(34rem,calc(100%-10rem))] -translate-x-1/2 flex-col gap-1'
              : 'mt-2 flex flex-col gap-1',
          )}
        >
          {disabled && (
            <span
              id={hintId}
              className="tool-hint rounded-full border-2 border-line-2 bg-paper-2 px-3 py-1 text-center text-[12px] text-ink-2"
            >
              {disabled}
            </span>
          )}
          {annotationDisabled && annotationDisabled !== disabled && (
            <span
              id={annotationHintId}
              className="tool-hint rounded-full border-2 border-line-2 bg-paper-2 px-3 py-1 text-center text-[12px] text-ink-2"
            >
              {annotationDisabled}
            </span>
          )}
        </div>
      )}
    </TooltipProvider>
  )
}

import type { CueType } from '@binder/shared'
import { Magnet, Redo2, Search, Undo2 } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, focusRing } from '@/lib/utils'
import { useUndo } from '../undo/useUndo'
import { useMarkupSession } from './MarkupSession'
import { TOOL_DEFS } from './MarkupTools'
import { StampPicker } from './StampPicker'
import { setStamp, setTool, useTool } from './tools'

const BUTTON = cn(
  'relative flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-2',
  'transition-colors hover:bg-elev hover:text-ink active:translate-y-px',
  focusRing,
  'focus-visible:ring-offset-paper-2',
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ink-2',
  // The active tool is red (DESIGN 8): live state, never decoration.
  'aria-pressed:bg-red aria-pressed:text-primary-foreground aria-pressed:hover:bg-red aria-pressed:hover:text-primary-foreground',
)
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
      className="pointer-events-none absolute right-1 bottom-0.5 font-mono text-[11px] leading-none text-current opacity-60"
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

/** Tool options that appear beside their tool while it is chosen (below it when the strip is inline). */
function Flyout({ floating, children }: { floating: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'absolute z-20 rounded-[12px] border-2 border-line-2 bg-elev p-1.5 shadow-card',
        floating ? 'top-1/2 left-full ml-2 -translate-y-1/2' : 'top-full left-0 mt-1',
      )}
    >
      {children}
    </div>
  )
}

/**
 * The markup tools, as a column floating at the stage's left edge (DESIGN 6.2), or inline (the
 * phone's "More tools"): select, the cue tool and the annotation tools with their keys in the
 * corner, find in the document, undo and redo, and snap to text. The cue's type and the stamp it
 * places show beside their tool while it is chosen. Why a tool is off (an archived show, an old
 * version) is said on the stage and wired to the tool with `aria-describedby`.
 */
export function ToolStrip({ variant = 'floating' }: { variant?: 'floating' | 'inline' }) {
  const session = useMarkupSession()
  const { tool, cueType, stamp } = useTool()
  const undo = useUndo(session.showId)
  const hintId = useId()
  const annotationHintId = useId()
  const floating = variant === 'floating'
  const disabled = 'disabled' in session.cueTarget ? session.cueTarget.disabled : null
  const annotationDisabled =
    'disabled' in session.annotationTarget ? session.annotationTarget.disabled : null
  // One hint element serves both groups when the reason is the same (an archived show).
  const annotationHint = annotationDisabled === disabled ? hintId : annotationHintId
  const readOnly = session.versionReadOnly

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
        className={BUTTON}
        onClick={() => setTool(t === 'select' || tool === t ? 'select' : t)}
      >
        <Icon className="size-[18px]" strokeWidth={1.8} aria-hidden />
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
              <option value="warn">Warning</option>
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

  const divider = (
    <hr
      className={cn('shrink-0 border-0 bg-line-2', floating ? 'my-1 h-px w-6' : 'mx-1 h-6 w-px')}
    />
  )

  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={150}>
      <fieldset
        aria-label="Markup tools"
        className={cn(
          'markup-tools m-0 flex min-w-0 items-center gap-0.5 rounded-[14px] border-2 border-line-2 bg-paper-2 p-0.5 shadow-card',
          floating ? 'absolute top-3 left-2 z-10 flex-col' : 'flex-wrap',
        )}
      >
        {toolButton(TOOL_DEFS[0])}
        {toolButton(TOOL_DEFS[1])}
        {divider}
        {TOOL_DEFS.slice(2).map(toolButton)}
        {divider}
        <Tip floating={floating} label="Find in document" keyHint="/">
          <button
            type="button"
            aria-label="Find in document"
            aria-keyshortcuts="/"
            className={BUTTON}
            onClick={() => session.viewer.current?.focusSearch()}
          >
            <Search className="size-[18px]" strokeWidth={1.8} aria-hidden />
            <KeyHint>/</KeyHint>
          </button>
        </Tip>
        {divider}
        <Tip floating={floating} label="Undo" keyHint="⌘Z">
          <button
            type="button"
            aria-label="Undo"
            className={BUTTON}
            disabled={!undo.canUndo || readOnly !== null}
            title={readOnly ?? undefined}
            onClick={() => void undo.undo()}
          >
            <Undo2 className="size-[18px]" strokeWidth={1.8} aria-hidden />
          </button>
        </Tip>
        <Tip floating={floating} label="Redo" keyHint="⇧⌘Z">
          <button
            type="button"
            aria-label="Redo"
            className={BUTTON}
            disabled={!undo.canRedo || readOnly !== null}
            title={readOnly ?? undefined}
            onClick={() => void undo.redo()}
          >
            <Redo2 className="size-[18px]" strokeWidth={1.8} aria-hidden />
          </button>
        </Tip>
        <Tip floating={floating} label="Snap to text">
          <label
            className={cn(
              BUTTON,
              'cursor-pointer has-[:checked]:bg-card has-[:checked]:text-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-red has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-paper-2',
            )}
          >
            <input
              type="checkbox"
              className="peer sr-only"
              checked={session.snap}
              onChange={(e) => session.setSnap(e.target.checked)}
            />
            <Magnet className="size-[18px]" strokeWidth={1.8} aria-hidden />
            <span className="sr-only">Snap to text</span>
          </label>
        </Tip>
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

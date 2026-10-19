import type { ReactNode } from 'react'
import { RedoIcon, UndoIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useUndo } from '../undo/useUndo'
import { useMarkupSession } from './MarkupSession'

/**
 * Undo and redo, the one component for both places they are drawn. In the top bar (the default)
 * they are the mockup's two icon-only ghost buttons with a tooltip. In the phone menu's inline
 * strip (`strip`) they are that strip's own buttons (`buttonClassName`, `iconClassName`), with no
 * tooltip since a touch screen has no hover. They undo what this person did in the show, so only
 * a ready version has them; an old version is read-only and says why in the button's title.
 */
export function UndoRedoButtons({
  strip,
}: {
  strip?: { buttonClassName: string; iconClassName: string }
}) {
  const session = useMarkupSession()
  const undo = useUndo(session.showId)
  const readOnly = session.versionReadOnly

  function control(name: 'Undo' | 'Redo', keys: string, off: boolean, run: () => void) {
    const Icon = name === 'Undo' ? UndoIcon : RedoIcon
    const props = {
      'aria-label': name,
      disabled: off || readOnly !== null,
      title: readOnly ?? undefined,
      onClick: run,
    }
    const button: ReactNode = strip ? (
      <button type="button" className={strip.buttonClassName} {...props}>
        <Icon className={strip.iconClassName} />
      </button>
    ) : (
      <Button type="button" variant="ghost" size="sm" {...props}>
        <Icon />
      </Button>
    )
    if (strip) return button
    return (
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-2">
          {name}
          <Kbd>{keys}</Kbd>
        </TooltipContent>
      </Tooltip>
    )
  }

  const buttons = (
    <>
      {control('Undo', '⌘Z', !undo.canUndo, () => void undo.undo())}
      {control('Redo', '⇧⌘Z', !undo.canRedo, () => void undo.redo())}
    </>
  )
  return strip ? (
    buttons
  ) : (
    <TooltipProvider delayDuration={500} skipDelayDuration={150}>
      {buttons}
    </TooltipProvider>
  )
}

import { RedoIcon, UndoIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useUndo } from '../undo/useUndo'
import { useMarkupSession } from './MarkupSession'

/**
 * Undo and redo as the mockup's top bar draws them: two icon-only ghost buttons. Inside the
 * markup session (they undo what this person did in the show), so only a ready version has them;
 * an old version is read-only and says why in the button's title.
 */
export function UndoRedoButtons() {
  const session = useMarkupSession()
  const undo = useUndo(session.showId)
  const readOnly = session.versionReadOnly
  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={150}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Undo"
            disabled={!undo.canUndo || readOnly !== null}
            title={readOnly ?? undefined}
            onClick={() => void undo.undo()}
          >
            <UndoIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-2">
          Undo
          <Kbd>⌘Z</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Redo"
            disabled={!undo.canRedo || readOnly !== null}
            title={readOnly ?? undefined}
            onClick={() => void undo.redo()}
          >
            <RedoIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-2">
          Redo
          <Kbd>⇧⌘Z</Kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

import { Plus } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { useMarkupSession } from './MarkupSession'
import { useTool } from './tools'

/**
 * Phone only: the red "Place cue" button that floats at the stage's bottom right while nothing is
 * selected (m-markup). A phone has no pointer to aim the `c` key or the cue tool with, so it places
 * the cue at the middle of the page in view, through the same path as the tool (`placeCue`: snap,
 * numbering, the department of the active layer), which then selects it and so opens the drawer.
 * It is 56 px high; when cues cannot be placed (an archived show, an old version) it is off, and
 * says why.
 */
export function PlaceCueButton({ hidden = false }: { hidden?: boolean }) {
  const session = useMarkupSession()
  const { cueType } = useTool()
  const hintId = useId()
  if (hidden) return null
  const why = 'disabled' in session.cueTarget ? session.cueTarget.disabled : null
  return (
    <div className="place-cue absolute right-4 bottom-4 z-20 flex max-w-[calc(100%-2rem)] flex-col items-end gap-2">
      {why && (
        // touch has no hover: the reason is on screen, and the button is described by it
        <span
          id={hintId}
          className="tool-hint rounded-[12px] border-2 border-line-2 bg-paper-2 px-3 py-1.5 text-right text-[12px] text-ink-2"
        >
          {why}
        </span>
      )}
      <Button
        type="button"
        size="lg"
        className="h-14 before:h-14 md:before:h-14 min-w-14 gap-2 rounded-[16px] px-5 text-[16px]"
        disabled={why !== null}
        aria-describedby={why ? hintId : undefined}
        onClick={() => {
          const at = session.viewer.current?.visiblePoint()
          if (at) void session.placeCue(at.pageIndex, at.point, cueType)
        }}
      >
        <Plus aria-hidden className="!size-5" strokeWidth={2.2} />
        Place cue
      </Button>
    </div>
  )
}

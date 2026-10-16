import { Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToolStrip } from './ToolStrip'

/**
 * The markup tools at phone width, where the floating strip has no room beside the page: the same
 * strip, inline, in a popover. The phone's "Place cue" button arrives with the cue sheet.
 */
export function MoreTools() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="More tools">
          <Wrench aria-hidden className="!size-4" strokeWidth={1.8} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-24px)] p-2">
        <ToolStrip variant="inline" />
      </PopoverContent>
    </Popover>
  )
}

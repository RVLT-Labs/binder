import * as React from 'react'

import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-20 w-full rounded-[12px] border-2 border-input bg-paper px-3.5 py-2 text-[16px] text-ink md:rounded-[9px] md:px-[9px] md:text-[13px] placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45 aria-[invalid=true]:border-t-out aria-[invalid=true]:focus-visible:ring-t-out',
      'resize-y',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export { Textarea }

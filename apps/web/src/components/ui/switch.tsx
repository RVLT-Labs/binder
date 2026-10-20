import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as React from 'react'

import { cn } from '@/lib/utils'

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      // A 32px track inside a 44px layout target; the thumb stays centred on the track.
      "relative isolate inline-flex h-11 w-[52px] shrink-0 cursor-pointer items-center rounded-full border-0 bg-transparent before:pointer-events-none before:absolute before:inset-x-0 before:top-1/2 before:-z-10 before:h-8 before:-translate-y-1/2 before:rounded-full before:border-2 before:border-input before:bg-paper-2 before:content-['']",
      'data-[state=checked]:before:bg-ok data-[state=checked]:before:border-ok',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
      'disabled:cursor-not-allowed disabled:opacity-45',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none size-6 rounded-full bg-ink ring-0 transition-transform',
        'translate-x-1 data-[state=checked]:translate-x-6 data-[state=checked]:bg-dark',
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }

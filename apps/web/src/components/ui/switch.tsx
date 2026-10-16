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
      // the mockups' `.mb-tog .tr`: 52 x 32, green when on. The `after:` layer is its hit area: 44 px
      // tall on a phone and on a touch screen, so the drawn track stays the mockup's.
      "relative inline-flex h-8 w-[52px] shrink-0 cursor-pointer items-center rounded-full border-2 border-border bg-paper-2 transition-[background-color,border-color] max-md:after:absolute max-md:after:-inset-y-2 max-md:after:inset-x-0 pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2 pointer-coarse:after:inset-x-0 after:content-['']",
      'data-[state=checked]:bg-ok data-[state=checked]:border-ok',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
      'disabled:cursor-not-allowed disabled:opacity-45',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none size-6 rounded-full bg-ink ring-0 transition-transform',
        'translate-x-0.5 data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-dark',
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }

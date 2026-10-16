import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // the mockups' `.dx-cb`: 16 px, radius 5, paper fill, ink when checked. The `after:` layer
      // is the hit area: 40 px with a mouse (the box's 12 px inside its border, 14 px each side) and
      // 44 px on a touch screen (a coarse pointer: 16 px each side) and on any phone-width window.
      "relative size-4 shrink-0 rounded-[5px] border-2 border-border bg-paper transition-[background-color,border-color] after:absolute after:-inset-[14px] max-md:after:-inset-4 pointer-coarse:after:-inset-4 after:content-['']",
      'data-[state=checked]:bg-ink data-[state=checked]:border-ink',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
      'disabled:cursor-not-allowed disabled:opacity-45',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      <Check className="size-2.5 text-paper" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }

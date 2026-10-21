import { Search } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** `lg` retains the sign-in field’s larger type; every native field reserves a 44 px minimum target. */
  inputSize?: 'default' | 'lg'
}

/**
 * The mockups' field (`.field .in`): 2px outline on the paper ground (darker than the card it sits
 * in), red focus ring. At 768 px and up the 44 px target floor bounds the nominal field heights,
 * with radius 9 and 13 px text (`lg`: 14 px).
 * Phone: 48 px, radius 12, 16 px text (which is also the iOS no-zoom floor, §16.13). Set
 * aria-invalid for the error state (§9.1).
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, inputSize = 'default', ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-12 min-h-11 min-w-11 w-full rounded-[12px] border-2 border-input bg-paper px-3.5 py-0 text-[16px] text-ink',
        'md:rounded-[9px] md:px-[9px]',
        inputSize === 'lg' ? 'md:h-[38px] md:text-[14px]' : 'md:h-[30px] md:text-[13px]',
        'placeholder:text-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
        'aria-[invalid=true]:border-t-out aria-[invalid=true]:focus-visible:ring-t-out',
        'disabled:cursor-not-allowed disabled:opacity-45',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

/**
 * SearchInput — the leading-icon search box used in list toolbars (R-8.7.3).
 * Wraps its own `relative` positioning; size the outer layout slot around it.
 */
const SearchInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        ref={ref}
        className={cn(
          'h-11 min-h-11 min-w-11 w-full rounded-[var(--r)] border-2 border-input bg-card pl-9 pr-3 text-[14px] text-ink placeholder:text-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red',
          className,
        )}
        {...props}
      />
    </div>
  ),
)
SearchInput.displayName = 'SearchInput'

export { Input, SearchInput }

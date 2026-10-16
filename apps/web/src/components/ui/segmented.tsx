import * as ToggleGroup from '@radix-ui/react-toggle-group'

import { cn } from '@/lib/utils'

export interface SegmentedOption {
  value: string
  label: React.ReactNode
}

export interface SegmentedProps {
  value: string
  onValueChange: (value: string) => void
  options: SegmentedOption[]
  'aria-label': string
  className?: string
}

/**
 * Segmented control (the mockups' `.seg`): one 2px outline, radius 9 (12 on phone, where the items
 * are 44 px), no track fill or padding; the chosen item is `elev`.
 * Radix ToggleGroup gives roving focus + arrow keys; roles are explicit so it reads as a
 * radiogroup (items are role="radio" with aria-checked).
 */
export function Segmented({ value, onValueChange, options, className, ...rest }: SegmentedProps) {
  return (
    <ToggleGroup.Root
      type="single"
      role="radiogroup"
      aria-label={rest['aria-label']}
      value={value}
      // A single ToggleGroup deselects to "" when the active item is pressed; a radio group never does.
      onValueChange={(next) => {
        if (next) onValueChange(next)
      }}
      className={cn(
        'inline-flex items-center overflow-hidden rounded-[12px] border-2 border-line-2 md:rounded-[9px]',
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          role="radio"
          aria-checked={option.value === value}
          className={cn(
            'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 px-3 font-sans text-[14px] font-semibold text-muted transition-colors md:h-[27px] md:px-2.5 md:text-[12px]',
            'hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red',
            'disabled:cursor-not-allowed disabled:opacity-45',
            'data-[state=on]:bg-elev data-[state=on]:text-ink',
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

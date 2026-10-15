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
 * Segmented control (DESIGN §8): single-select radio group on a paper-2 track.
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
        'inline-flex items-center gap-0.5 rounded-[10px] border-2 border-line-2 bg-paper-2 p-0.5',
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
            'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[7px] px-3 font-sans text-[13px] font-semibold text-ink-2 transition-colors md:h-8',
            'hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-1 focus-visible:ring-offset-paper-2',
            'disabled:cursor-not-allowed disabled:opacity-45',
            'data-[state=on]:bg-card data-[state=on]:text-ink data-[state=on]:shadow-card',
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

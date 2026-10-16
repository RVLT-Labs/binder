import { cn } from '@/lib/utils'

interface KbdProps {
  /** Shortcut string to display (e.g., "N", "⌘K", "Ctrl+S") */
  children: React.ReactNode
  className?: string
}

/**
 * Keyboard shortcut badge — displayed inline in buttons and tooltips.
 * Per DESIGN.md: display shortcut hints in button tooltips.
 */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center rounded-[5px] border border-b-2 border-line-2 bg-paper-2 px-1.5',
        'font-mono text-[10.5px] text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

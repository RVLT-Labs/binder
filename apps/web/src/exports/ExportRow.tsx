import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { fileTypeOf } from './when'

/**
 * One export in the list (the mockup's `.dx-ex`): a file-type tile, the file name in mono, a meta
 * line (layers, time, who can see it) and the actions. On a phone the actions drop under the text.
 * Extra attributes (`data-export-id`, `data-pending`) go on the `<li>`.
 */
export function ExportRow({
  filename,
  meta,
  actions,
  className,
  ...rest
}: {
  filename: string
  meta: ReactNode
  actions: ReactNode
} & HTMLAttributes<HTMLLIElement>) {
  return (
    <li
      className={cn(
        'export-row grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2 border-t border-line p-4 first:border-t-0',
        'max-md:grid-cols-[36px_minmax(0,1fr)] max-md:p-3.5',
        className,
      )}
      {...rest}
    >
      <div className="export-tile grid h-11 w-9 place-items-center rounded-[5px] border-2 border-line-2 bg-paper-2 font-mono text-[9.5px] font-semibold tracking-[0.02em] text-muted">
        {fileTypeOf(filename)}
      </div>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <div className="export-name font-mono text-[13px] break-all text-ink tabular-nums">
          {filename}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          {meta}
        </div>
      </div>
      <div className="export-actions flex flex-wrap items-center gap-x-4 gap-y-2 max-md:col-span-2 max-md:col-start-1 max-md:gap-x-3">
        {actions}
      </div>
    </li>
  )
}

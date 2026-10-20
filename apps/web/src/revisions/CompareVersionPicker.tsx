import { ChevronDownIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import type { DocumentVersionRow } from '../powersync/schema'

const short = (v: DocumentVersionRow) => `v${v.version_number}`

/** A version picker drawn as the mockup's `.dx-vchip`: mono, outlined, the compared-to one lit. */
function VersionChip({
  name,
  value,
  versions,
  on,
  onChange,
}: {
  name: string
  value: string
  versions: DocumentVersionRow[]
  on?: boolean
  onChange: (id: string) => void
}) {
  return (
    <span className="relative inline-flex min-w-11 shrink-0">
      <select
        aria-label={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-11 min-h-11 min-w-11 appearance-none rounded-[8px] border-2 border-input bg-card pr-6 pl-2.5 font-mono text-[12px] text-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red',
          on && 'bg-elev text-ink',
          'max-md:h-11 max-md:rounded-[12px] max-md:pr-8 max-md:pl-3 max-md:text-[14px]',
        )}
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {short(v)}
          </option>
        ))}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-muted"
      />
    </span>
  )
}

/** The same native selectors in the comparison bar and its phone strip. */
export function CompareVersionPicker({
  versions,
  from,
  to,
  onFromChange,
  onToChange,
}: {
  versions: DocumentVersionRow[]
  from: string
  to: string
  onFromChange: (id: string) => void
  onToChange: (id: string) => void
}) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <VersionChip name="From" value={from} versions={versions} onChange={onFromChange} />
      <span aria-hidden className="text-muted">
        →
      </span>
      <VersionChip name="To" value={to} versions={versions} on onChange={onToChange} />
    </span>
  )
}

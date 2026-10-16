import { deptChrome } from '@binder/shared'
import { useEffect, useRef } from 'react'
import { Segmented } from '@/components/ui/segmented'
import { SelectField, Swatch } from '../panel/fields'
import type { KindFilter } from './api'

export interface FilterDepartment {
  id: string
  code: string
  /** The department's colour from data; drawn as its chrome tint. */
  colour: string | null
}

const ALL = 'all'

const KIND_OPTIONS: Array<{ value: KindFilter; label: string }> = [
  { value: 'all', label: 'People and agents' },
  { value: 'human', label: 'People' },
  { value: 'agent', label: 'Agents' },
]

/**
 * The activity feed's two filters, as the mockup draws them: a "Layer" segmented control (All
 * layers, each department by its code with its swatch, then your own Personal layer) and a "Changes
 * by" one (People and agents, People, Agents). A show can have more departments than fit across a
 * phone, so the layer control scrolls sideways inside its own box there, and the chosen layer stays
 * in view; "Changes by" is the mockup's select on a phone.
 */
export function ActivityFilters({
  departments,
  userId,
  layer,
  kind,
  onLayerChange,
  onKindChange,
}: {
  departments: FilterDepartment[]
  userId: string | undefined
  /** The layer key (`department:<id>` / `personal:<userId>`), or '' for every layer. */
  layer: string
  kind: KindFilter
  onLayerChange: (layer: string) => void
  onKindChange: (kind: KindFilter) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the chosen layer moved
  useEffect(() => {
    box.current
      ?.querySelector('[aria-checked="true"]')
      ?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [layer])
  return (
    <>
      <div
        ref={box}
        className="max-md:w-full max-md:min-w-0 max-md:overflow-x-auto max-md:[scrollbar-width:none] max-md:rounded-[12px]"
      >
        <Segmented
          aria-label="Layer"
          // a segmented value is never empty (the group reads '' as "nothing chosen")
          value={layer || ALL}
          onValueChange={(v) => onLayerChange(v === ALL ? '' : v)}
          className="max-md:flex max-md:w-full max-md:min-w-max max-md:bg-paper"
          itemClassName="max-md:flex-1 max-md:shrink-0 max-md:px-3.5 max-md:whitespace-nowrap"
          options={[
            { value: ALL, label: 'All layers' },
            ...departments.map((d) => ({
              value: `department:${d.id}`,
              label: (
                <>
                  {d.colour && <Swatch colour={deptChrome(d.colour)} className="mr-0.5" />}
                  {d.code}
                </>
              ),
            })),
            ...(userId ? [{ value: `personal:${userId}`, label: 'Personal' }] : []),
          ]}
        />
      </div>
      <Segmented
        aria-label="Changes by"
        value={kind}
        onValueChange={(v) => onKindChange(v as KindFilter)}
        options={KIND_OPTIONS}
        className="max-md:hidden"
      />
      <div className="w-[204px] md:hidden max-md:order-2">
        <SelectField
          aria-label="Changes by"
          value={kind}
          onChange={(e) => onKindChange(e.target.value as KindFilter)}
          className="font-semibold text-ink-2"
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      </div>
    </>
  )
}

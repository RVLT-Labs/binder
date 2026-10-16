import { type LayerRef, layerKey, PERSONAL_LAYER_COLOUR } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { EyeIcon, EyeOffIcon, LockIcon, UnlockIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { SECTION_LABEL, Swatch } from '../panel/fields'
import { useLayers } from './useLayers'

interface Row {
  layer: LayerRef
  code: string
  name: string
  colour: string
}

/** The icon box: 16 px at 768 and up (`.layer-row .ic span`), a 44 px target on a phone. */
const ICON_BOX =
  'relative grid size-4 shrink-0 place-items-center text-faint max-md:size-11 md:max-[1024px]:size-8'

/**
 * A visibility or lock switch drawn as the mockup's icon: a real checkbox underneath (its label is
 * the accessible name and it takes the focus), the icon on top. `on` and `off` are the icons for
 * the checked and unchecked state.
 */
function IconSwitch({
  label,
  checked,
  disabled,
  onChange,
  on,
  off,
  lit,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  on: React.ReactNode
  off: React.ReactNode
  /** The checked state is drawn in amber (a locked layer). */
  lit?: boolean
}) {
  return (
    <span className={cn(ICON_BOX, checked && lit && 'text-amber', 'z-10')}>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-[6px] opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        className="grid place-items-center peer-disabled:opacity-45 peer-focus-visible:ring-2 peer-focus-visible:ring-red rounded-[6px] size-full"
      >
        {checked ? on : off}
      </span>
    </span>
  )
}

/**
 * The show's layers for the signed-in user (the mockup's layer rows): every non-hidden department
 * and their personal layer, each with a swatch, name, item count, a visibility eye and a lock, and
 * the choice of active layer (only layers they can edit). The row is the radio: pressing anywhere
 * on it makes the layer active, and the active row is raised on the card fill. Visibility is
 * remembered on this device; locks last for the session; neither affects anyone else.
 */
export function LayerPanel({
  showId,
  versionId,
  labelled = false,
}: {
  showId: string
  versionId?: string
  /** Draw the heading as the mockup's section label (under a cue's fields); otherwise it is for readers only. */
  labelled?: boolean
}) {
  const { userId, departments, editable, active, state, store } = useLayers(showId)
  const { data: cueCounts } = useQuery<{ id: string | null; n: number }>(
    `SELECT department_id AS id, COUNT(*) AS n FROM cues
     WHERE show_id = ? AND json_extract(anchor, '$.documentVersionId') = ? GROUP BY department_id`,
    [showId, versionId ?? ''],
  )
  const { data: noteCounts } = useQuery<{ kind: string | null; id: string | null; n: number }>(
    `SELECT layer_kind AS kind, layer_id AS id, COUNT(*) AS n FROM annotations
     WHERE show_id = ? AND json_extract(anchor, '$.documentVersionId') = ? GROUP BY layer_kind, layer_id`,
    [showId, versionId ?? ''],
  )
  if (!userId) return null
  const count = (layer: LayerRef) =>
    layer.kind === 'department'
      ? (cueCounts.find((c) => c.id === layer.id)?.n ?? 0) +
        (noteCounts.find((c) => c.kind !== 'personal' && c.id === layer.id)?.n ?? 0)
      : (noteCounts.find((c) => c.kind === 'personal' && c.id === layer.id)?.n ?? 0)
  const rows: Row[] = [
    ...departments
      .filter((d) => !d.hidden)
      .map((d) => ({
        layer: { kind: 'department' as const, id: d.id },
        code: d.code ?? '',
        name: d.name ?? '',
        colour: d.colour ?? PERSONAL_LAYER_COLOUR,
      })),
    {
      layer: { kind: 'personal', id: userId },
      code: 'Personal',
      name: '',
      colour: PERSONAL_LAYER_COLOUR,
    },
  ]
  const activeKey = active ? layerKey(active) : null

  return (
    <section className="layer-panel flex flex-col gap-2" aria-label="Layers">
      <h2 className={labelled ? SECTION_LABEL : 'sr-only'}>Layers</h2>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {rows.map(({ layer, code, name, colour }) => {
          const key = layerKey(layer)
          const canEdit = editable.some((l) => layerKey(l) === key)
          const hidden = state.hidden.includes(key)
          const locked = state.locked.includes(key)
          const isActive = activeKey === key
          return (
            <li
              key={key}
              data-layer={key}
              className={cn(
                // `.layer-row`: 30 px (38 on the tablet sheet, a 44 px target on a phone), radius 8, 13 px
                'relative flex h-[30px] items-center gap-2 rounded-[8px] px-2 text-[13px] text-ink max-md:h-11 md:max-[1024px]:h-[38px]',
                'has-[input[type=radio]:focus-visible]:ring-2 has-[input[type=radio]:focus-visible]:ring-red',
                isActive && 'bg-card shadow-card',
                hidden && 'opacity-55',
              )}
            >
              <input
                type="radio"
                name={`active-layer-${showId}`}
                aria-label={`Active layer ${code}`}
                title={canEdit ? 'Make this the active layer' : "You can't edit this layer"}
                checked={isActive}
                disabled={!canEdit}
                onChange={() => store.setActive(layer)}
                className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-[8px] opacity-0 disabled:cursor-not-allowed"
              />
              <Swatch colour={colour} />
              <span
                className="layer-name min-w-0 flex-1 truncate"
                title={name ? `${code} · ${name}` : 'Only you see this layer'}
              >
                {code}
                {!name && code === 'Personal' && (
                  <span className="ml-1.5 text-[11px] text-faint">only you</span>
                )}
              </span>
              <span className="font-mono text-[11px] text-faint tabular-nums">{count(layer)}</span>
              <span className="flex gap-1.5">
                <IconSwitch
                  label={`Show ${code}`}
                  checked={!hidden}
                  onChange={(on) => store.setHidden(key, !on)}
                  on={<EyeIcon className="size-3.5" strokeWidth={1.8} />}
                  off={<EyeOffIcon className="size-3.5" strokeWidth={1.8} />}
                />
                <IconSwitch
                  label={`Lock ${code}`}
                  checked={locked}
                  disabled={!canEdit}
                  onChange={(on) => store.setLocked(key, on)}
                  on={<LockIcon className="size-3.5" strokeWidth={1.8} />}
                  off={<UnlockIcon className="size-3.5" strokeWidth={1.8} />}
                  lit
                />
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

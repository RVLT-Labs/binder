import { type LayerRef, layerKey, PERSONAL_LAYER_COLOUR } from '@binder/shared'
import { useLayers } from './useLayers'

interface Row {
  layer: LayerRef
  code: string
  name: string
  colour: string
}

/**
 * The show's layers for the signed-in user: every non-hidden department and their personal layer,
 * each with a visibility toggle, a lock, and the choice of active layer (only layers they can edit).
 * Visibility is remembered on this device; locks last for the session; neither affects anyone else.
 */
export function LayerPanel({ showId }: { showId: string }) {
  const { userId, departments, editable, active, state, store } = useLayers(showId)
  if (!userId) return null
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
    <section className="layer-panel" aria-label="Layers">
      <h2>Layers</h2>
      <ul>
        {rows.map(({ layer, code, name, colour }) => {
          const key = layerKey(layer)
          const canEdit = editable.some((l) => layerKey(l) === key)
          return (
            <li key={key} data-layer={key}>
              <input
                type="radio"
                name={`active-layer-${showId}`}
                aria-label={`Active layer ${code}`}
                title={canEdit ? 'Make this the active layer' : "You can't edit this layer"}
                checked={activeKey === key}
                disabled={!canEdit}
                onChange={() => store.setActive(layer)}
              />
              <span className="department-swatch" style={{ background: colour }} />
              <span
                className="layer-name"
                title={name ? `${code} · ${name}` : 'Only you see this layer'}
              >
                <strong>{code}</strong> {name && <span className="muted">{name}</span>}
              </span>
              <label className="layer-toggle">
                <input
                  type="checkbox"
                  aria-label={`Show ${code}`}
                  checked={!state.hidden.includes(key)}
                  onChange={(e) => store.setHidden(key, !e.target.checked)}
                />
                Show
              </label>
              <label className="layer-toggle">
                <input
                  type="checkbox"
                  aria-label={`Lock ${code}`}
                  checked={state.locked.includes(key)}
                  disabled={!canEdit}
                  onChange={(e) => store.setLocked(key, e.target.checked)}
                />
                Lock
              </label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

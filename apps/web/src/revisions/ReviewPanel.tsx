import {
  type Anchor,
  type LayerRef,
  layerKey,
  parseLayerKey,
  type ReviewItem,
} from '@binder/shared'
import { usePowerSync } from '@powersync/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { pushNotice } from '../components/noticeStore'
import { useMarkupSession } from '../markup/MarkupSession'
import { startRelocate } from '../markup/relocate'
import { select } from '../markup/selection'
import { setTool, startRebind } from '../markup/tools'
import { useOnline } from '../offline/useOnline'
import { type ReviewAction as ApiAction, reviewKey, useResolveItem, useReview } from './api'
import { ReviewThumb } from './ReviewThumb'
import { type ReviewAction, reviewItemActions } from './reviewActions'
import { useReviewCount } from './useReviewCount'

export interface ReviewPanelProps {
  documentId: string
  /** Version number by id, for captions. */
  versionNumbers: ReadonlyMap<string, number>
  onClose: () => void
}

const STATUS_LABEL = { ok: 'Placed', approximate: 'Approximate', unresolved: 'Not found' } as const

/** Items grouped by layer, in the order the server sent them. */
function byLayer(items: readonly ReviewItem[]): Array<{ layer: string; items: ReviewItem[] }> {
  const groups: Array<{ layer: string; items: ReviewItem[] }> = []
  for (const item of items) {
    const group = groups.find((g) => g.layer === item.layer)
    if (group) group.items.push(item)
    else groups.push({ layer: item.layer, items: [item] })
  }
  return groups
}

/**
 * The re-anchoring review (spec 5.4): what a revision could not place exactly, grouped by layer,
 * each with where it was and where it is now. Accept keeps the new place; Move lets the user put it
 * right by hand; Revert sends it back to the old version. Items still on an older version (for
 * example placed by an offline client after the switch) wait in a collapsed section. Needs the
 * server: the "before" positions are in the change log.
 */
export function ReviewPanel({ documentId, versionNumbers, onClose }: ReviewPanelProps) {
  const session = useMarkupSession()
  const db = usePowerSync()
  const online = useOnline()
  const count = useReviewCount(documentId)
  const review = useReview(documentId, true, count)
  const resolve = useResolveItem(documentId)
  const queryClient = useQueryClient()
  const [hint, setHint] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => heading.current?.focus(), [])

  /** Why the user may not change this item's layer, in the session's own words, or null. */
  const whyCantEdit = (item: ReviewItem): string | null => {
    const layer: LayerRef | null = parseLayerKey(item.layer)
    if (!layer) return "You can't edit this layer."
    return item.table === 'cues'
      ? session.whyCantEdit({ department_id: layer.id })
      : session.whyCantEditAnnotation({ layer_kind: layer.kind, layer_id: layer.id })
  }

  async function move(item: ReviewItem, section: 'pending' | 'older') {
    setTool('select')
    // A highlight is bound to its words, so it is moved by selecting the words again.
    const type =
      item.table === 'annotations'
        ? (
            await db.getOptional<{ type: string | null }>(
              'SELECT type FROM annotations WHERE id = ?',
              [item.rowId],
            )
          )?.type
        : null
    const isHighlight = type === 'highlight'
    if (isHighlight) {
      startRebind(item.rowId)
      select('annotations', item.rowId)
      setHint('Drag across the words on the page where this highlight belongs.')
      return
    }
    if (section === 'older') {
      startRelocate(item.table, item.rowId)
      setHint('Click the page where this belongs on this version. Escape cancels.')
      return
    }
    const cue = item.table === 'cues' ? session.view.ordered.find((c) => c.id === item.rowId) : null
    const note =
      item.table === 'annotations'
        ? [...session.view.annotationsByPage.values()].flat().find((a) => a.id === item.rowId)
        : null
    if (cue) session.showCue(cue)
    else if (note) {
      select('annotations', note.id)
      session.viewer.current?.scrollToPoint(note.anchor.pageIndex, note.anchor.y)
    } else {
      pushNotice({
        kind: 'info',
        message: `${item.title} is on a hidden layer. Show the layer to move it.`,
      })
      return
    }
    setHint('Drag the selected marker to where it belongs; dropping it marks it placed.')
  }

  function run(item: ReviewItem, action: ReviewAction) {
    if (action.kind === 'move') {
      move(
        item,
        item.anchor.documentVersionId === review.data?.currentVersionId ? 'pending' : 'older',
      ).catch((err: unknown) =>
        pushNotice({
          kind: 'error',
          message: `Could not start moving ${item.title}: ${err instanceof Error ? err.message : String(err)}`,
        }),
      )
      return
    }
    setHint(null)
    resolve.mutate({ table: item.table, rowId: item.rowId, action: action.kind as ApiAction })
  }

  const data = review.data
  return (
    <section className="review-panel" aria-label="Revision review">
      <header className="review-header">
        <h2 ref={heading} tabIndex={-1}>
          Review revision
        </h2>
        <button type="button" onClick={onClose}>
          Close review
        </button>
      </header>
      {!online ? (
        <p role="status" className="muted">
          Review needs a connection. Your cues and notes are safe; the count above still works.
        </p>
      ) : review.isPending ? (
        <p role="status">Loading the review…</p>
      ) : review.isError || !data ? (
        <p role="alert">Could not load the review: {review.error?.message ?? 'unknown error'}</p>
      ) : (
        <>
          {hint && (
            <p role="status" className="review-hint">
              {hint}
            </p>
          )}
          {data.pending.length === 0 ? (
            <p role="status">Nothing to review: every item is placed.</p>
          ) : (
            byLayer(data.pending).map((group) => (
              <LayerGroup
                key={group.layer}
                group={group}
                section="pending"
                versionNumbers={versionNumbers}
                whyCantEdit={whyCantEdit}
                onAction={run}
                busy={resolve.isPending}
              />
            ))
          )}
          {data.olderVersions.length > 0 && (
            <details className="review-older">
              <summary>On an older version ({data.olderVersions.length})</summary>
              {byLayer(data.olderVersions).map((group) => (
                <LayerGroup
                  key={group.layer}
                  group={group}
                  section="older"
                  versionNumbers={versionNumbers}
                  whyCantEdit={whyCantEdit}
                  onAction={run}
                  busy={resolve.isPending}
                />
              ))}
            </details>
          )}
          <button
            type="button"
            className="review-refresh"
            onClick={() => void queryClient.invalidateQueries({ queryKey: reviewKey(documentId) })}
          >
            Refresh
          </button>
        </>
      )}
    </section>
  )
}

function LayerGroup({
  group,
  section,
  versionNumbers,
  whyCantEdit,
  onAction,
  busy,
}: {
  group: { layer: string; items: ReviewItem[] }
  section: 'pending' | 'older'
  versionNumbers: ReadonlyMap<string, number>
  whyCantEdit: (item: ReviewItem) => string | null
  onAction: (item: ReviewItem, action: ReviewAction) => void
  busy: boolean
}) {
  const session = useMarkupSession()
  const layer = parseLayerKey(group.layer)
  const name = layer ? session.layerName(layer) : group.layer
  const colour = layer ? session.layerColour(layer) : '#6B7280'
  return (
    <section className="review-group" aria-label={`${name} layer`} data-layer={layerKeyOf(layer)}>
      <h3>
        <span className="layer-swatch" style={{ background: colour }} aria-hidden="true" />
        {name}
        <span className="muted"> ({group.items.length})</span>
      </h3>
      <ul>
        {group.items.map((item) => (
          <ReviewRow
            key={`${item.table}:${item.rowId}`}
            item={item}
            section={section}
            colour={colour}
            versionNumbers={versionNumbers}
            reason={whyCantEdit(item)}
            onAction={onAction}
            busy={busy}
          />
        ))}
      </ul>
    </section>
  )
}

const layerKeyOf = (layer: LayerRef | null) => (layer ? layerKey(layer) : '')

function caption(anchor: Anchor, versionNumbers: ReadonlyMap<string, number>): string {
  const n = versionNumbers.get(anchor.documentVersionId)
  return `${n ? `v${n}` : 'version'} · p.${anchor.pageIndex + 1}`
}

function ReviewRow({
  item,
  section,
  colour,
  versionNumbers,
  reason,
  onAction,
  busy,
}: {
  item: ReviewItem
  section: 'pending' | 'older'
  colour: string
  versionNumbers: ReadonlyMap<string, number>
  reason: string | null
  onAction: (item: ReviewItem, action: ReviewAction) => void
  busy: boolean
}) {
  const actions = reviewItemActions({
    section,
    hasPrevious: item.previous !== null,
    whyCantEdit: reason,
  })
  const status = STATUS_LABEL[item.anchor.status]
  return (
    <li className="review-item" data-review-item={item.rowId} data-status={item.anchor.status}>
      <div className="review-item-head">
        <strong>{item.title}</strong>
        <span className="badge" data-status={item.anchor.status}>
          {status}
        </span>
      </div>
      <div className="review-thumbs">
        <figure aria-label="Old position">
          {item.previous ? (
            <ReviewThumb anchor={item.previous} colour={colour} />
          ) : (
            <span className="review-thumb review-thumb-missing">No earlier position</span>
          )}
          <figcaption>
            Was {item.previous ? caption(item.previous, versionNumbers) : 'not moved by a revision'}
          </figcaption>
        </figure>
        <figure aria-label="New position">
          <ReviewThumb anchor={item.anchor} colour={colour} />
          <figcaption>Now {caption(item.anchor, versionNumbers)}</figcaption>
        </figure>
      </div>
      <div className="review-actions">
        {actions.map((a) => (
          <button
            key={a.kind}
            type="button"
            disabled={a.disabled !== null || busy}
            title={a.disabled ?? undefined}
            onClick={() => onAction(item, a)}
          >
            {a.label}
          </button>
        ))}
      </div>
      {[...new Set(actions.map((a) => a.disabled).filter((r) => r !== null))].map((why) => (
        <p key={why} className="muted review-reason">
          {why}
        </p>
      ))}
    </li>
  )
}

import {
  type Anchor,
  type LayerRef,
  layerKey,
  PERSONAL_LAYER_COLOUR,
  parseLayerKey,
  type ReviewItem,
} from '@binder/shared'
import { usePowerSync } from '@powersync/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { pushNotice } from '../components/noticeStore'
import { useMarkupSession } from '../markup/MarkupSession'
import { startRelocate } from '../markup/relocate'
import { select } from '../markup/selection'
import { setTool, startRebind } from '../markup/tools'
import { useOnline } from '../offline/useOnline'
import { Note, SECTION_LABEL, StatusPill, Swatch } from '../panel/fields'
import { type ReviewAction as ApiAction, reviewKey, useResolveItem, useReview } from './api'
import { ReviewThumb } from './ReviewThumb'
import { type ReviewAction, reviewItemActions } from './reviewActions'
import { useReviewCount } from './useReviewCount'

export interface ReviewPanelProps {
  documentId: string
  /** Version number by id, for captions. */
  versionNumbers: ReadonlyMap<string, number>
}

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
export function ReviewPanel({ documentId, versionNumbers }: ReviewPanelProps) {
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
    <section className="review-panel @container flex flex-col gap-3.5" aria-label="Revision review">
      <div className="grid gap-1.5">
        <h2
          ref={heading}
          tabIndex={-1}
          className="m-0 font-sans text-[13px] font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-red"
        >
          Review revision
        </h2>
        {data && data.pending.length > 0 && (
          <Note>
            Binder moved every cue to the new version; these{' '}
            <span className="font-mono tabular-nums">{data.pending.length}</span> need a look.
            Everything else is <StatusPill status="ok" className="h-4 align-middle" />.
          </Note>
        )}
      </div>
      {!online ? (
        <p role="status" className="m-0 text-[12.5px] text-muted">
          Review needs a connection. Your cues and notes are safe; the count above still works.
        </p>
      ) : review.isPending ? (
        <p role="status" className="m-0 text-[12.5px] text-muted">
          Loading the review…
        </p>
      ) : review.isError || !data ? (
        <p role="alert" className="m-0 text-[12.5px] text-t-out">
          Could not load the review: {review.error?.message ?? 'unknown error'}
        </p>
      ) : (
        <>
          {hint && (
            <p
              role="status"
              className="review-hint m-0 rounded-[8px] border-l-2 border-blue bg-blue-soft px-2.5 py-2 text-[12.5px] text-ink"
            >
              {hint}
            </p>
          )}
          {data.pending.length === 0 ? (
            <p role="status" className="m-0 text-[12.5px] text-muted">
              Nothing to review: every item is placed.
            </p>
          ) : (
            <div className="grid gap-3.5 [&>section:first-of-type_li:first-child]:border-t-0">
              <div className={SECTION_LABEL}>
                Pending <span className="text-muted">· on the current version</span>
              </div>
              {byLayer(data.pending).map((group) => (
                <LayerGroup
                  key={group.layer}
                  group={group}
                  section="pending"
                  versionNumbers={versionNumbers}
                  whyCantEdit={whyCantEdit}
                  onAction={run}
                  busy={resolve.isPending}
                />
              ))}
            </div>
          )}
          {data.olderVersions.length > 0 && (
            <details className="review-older grid gap-3.5 [&>section:first-of-type_li:first-child]:border-t-0">
              <summary
                className={`${SECTION_LABEL} cursor-pointer list-none max-md:min-h-11 [&::-webkit-details-marker]:hidden`}
              >
                On an older version{' '}
                <span className="text-muted">· {data.olderVersions.length}</span>
              </summary>
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
          <Button
            type="button"
            variant="line"
            size="sm"
            className="review-refresh self-start"
            onClick={() => void queryClient.invalidateQueries({ queryKey: reviewKey(documentId) })}
          >
            Refresh
          </Button>
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
  const colour = layer ? session.layerColour(layer) : PERSONAL_LAYER_COLOUR
  return (
    <section className="review-group" aria-label={`${name} layer`} data-layer={layerKeyOf(layer)}>
      {/* each item carries its own layer swatch and code (the mockup); the group is for readers */}
      <h3 className="sr-only">
        {name} ({group.items.length})
      </h3>
      <ul className="m-0 list-none p-0">
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

/**
 * The item's head as the mockup draws it: the layer's swatch and "LX 41" in the layer's colour,
 * the number in mono. `title` is `LX 12 · Fly out` for a cue and `note · first words` for an
 * annotation: what follows the first " · " is the label, which goes under it.
 */
function itemHead(item: ReviewItem): { head: string; label: string } {
  const [head = '', ...rest] = item.title.split(' · ')
  return { head, label: rest.join(' · ') }
}

function Title({ head, table }: { head: string; table: ReviewItem['table'] }) {
  const m = table === 'cues' ? /^(.*\S)\s+(\S+)$/.exec(head) : null
  if (!m) return <span>{head}</span>
  return (
    <span>
      {m[1]} <span className="font-mono tabular-nums">{m[2]}</span>
    </span>
  )
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
  const quote = item.anchor.text?.quote
  const { head, label } = itemHead(item)
  return (
    <li
      className="review-item grid grid-cols-[84px_84px_1fr] gap-x-3 gap-y-2 border-t border-line py-2.5 text-[13px] @[380px]:grid-cols-[1fr_84px_84px_auto] @[380px]:items-center"
      data-review-item={item.rowId}
      data-status={item.anchor.status}
    >
      <div className="grid min-w-0 gap-0.5 col-span-full @[380px]:col-auto">
        <div className="review-item-head flex flex-wrap items-center gap-x-1.5 gap-y-1 font-semibold text-ink">
          <Swatch colour={colour} />
          <Title head={head} table={item.table} />
          <StatusPill status={item.anchor.status} />
        </div>
        <p className="m-0 text-[12.5px] leading-snug text-muted">
          {label && <>{label} · </>}
          {quote && <>“{quote.length > 48 ? `${quote.slice(0, 47)}…` : quote}” · </>}
          {item.previous
            ? `was p.${item.previous.pageIndex + 1}, now p.${item.anchor.pageIndex + 1}`
            : 'not moved by a revision'}
        </p>
      </div>
      <figure aria-label="Old position" className="m-0 grid w-[84px] gap-0.5">
        {item.previous ? (
          <ReviewThumb anchor={item.previous} colour={colour} />
        ) : (
          <span className="review-thumb review-thumb-missing grid h-12 w-[84px] place-items-center rounded-[4px] border border-dashed border-line-2 bg-card px-1 text-center text-[11px] leading-tight text-muted">
            No earlier position
          </span>
        )}
        <figcaption className="text-[11px] leading-tight text-muted">
          Was {item.previous ? caption(item.previous, versionNumbers) : 'not moved by a revision'}
        </figcaption>
      </figure>
      <figure aria-label="New position" className="m-0 grid w-[84px] gap-0.5">
        <ReviewThumb anchor={item.anchor} colour={colour} />
        <figcaption className="text-[11px] leading-tight text-muted">
          Now {caption(item.anchor, versionNumbers)}
        </figcaption>
      </figure>
      <div className="review-actions col-span-full flex flex-wrap gap-1 @[380px]:col-auto @[380px]:flex-col">
        {actions.map((a, i) => (
          <Button
            key={a.kind}
            type="button"
            size="sm"
            variant={i === 0 ? 'primary' : i === 1 ? 'line' : 'ghost'}
            className={i > 1 ? 'text-muted hover:text-ink' : undefined}
            disabled={a.disabled !== null || busy}
            title={a.disabled ?? undefined}
            // the mockup's word is the short one; the name still says what it does
            aria-label={a.kind === 'revert' ? a.label : undefined}
            onClick={() => onAction(item, a)}
          >
            {a.kind === 'revert' ? 'Revert' : a.label}
          </Button>
        ))}
      </div>
      {[...new Set(actions.map((a) => a.disabled).filter((r) => r !== null))].map((why) => (
        <Note key={why} className="review-reason col-span-full">
          {why}
        </Note>
      ))}
    </li>
  )
}

import { layerSelectionLabel } from '@binder/core'
import { type LayerRef, layerKey } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { useEffect, useMemo, useState } from 'react'
import { useSessionUser } from '../auth/session'
import { useDepartments } from '../markup/useDepartments'
import type { ExportRecordRow } from '../powersync/schema'
import { type PendingExport, pendingExports, subscribeOutbox } from './outbox'

export type ExportRecord = ExportRecordRow & { id: string }

/**
 * The show's export records, newest first, from the local database (so the list works offline),
 * and this user's exports still waiting to upload. Another user's private export never reaches
 * the device; the query refuses it too in case one ever did.
 */
export function useExports(showId: string): {
  records: ExportRecord[]
  pending: PendingExport[]
} {
  const { data: user } = useSessionUser()
  const userId = user?.id ?? ''
  const { data: records } = useQuery<ExportRecord>(
    `SELECT * FROM export_records
     WHERE show_id = ? AND (private_to IS NULL OR private_to = ?)
     ORDER BY created_at DESC, id DESC`,
    [showId, userId],
  )
  const [waiting, setWaiting] = useState<PendingExport[]>([])
  useEffect(() => {
    if (!userId) return
    let live = true
    const load = () =>
      void pendingExports(userId).then(
        (list) => {
          if (live) setWaiting(list)
        },
        () => {},
      )
    load()
    const unsubscribe = subscribeOutbox(load)
    return () => {
      live = false
      unsubscribe()
    }
  }, [userId])
  const pending = useMemo(() => {
    // A record that has synced before the outbox noticed its upload finished is not still waiting.
    const recorded = new Set(records.map((r) => r.id))
    return waiting
      .filter((p) => p.showId === showId && !recorded.has(p.id))
      .sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt))
  }, [waiting, records, showId])
  return { records, pending }
}

function parseSelection(text: string | null): LayerRef[] {
  try {
    const value: unknown = JSON.parse(text ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter(
      (l): l is LayerRef =>
        !!l &&
        typeof l === 'object' &&
        (l.kind === 'department' || l.kind === 'personal') &&
        typeof l.id === 'string',
    )
  } catch {
    return []
  }
}

/** What an export's footer says about its layers, from the record's stored selection. */
export function useLayerLabeller(showId: string): (selection: string | null) => string {
  const departments = useDepartments(showId)
  return (selection) => {
    const layers = parseSelection(selection)
    const picked = new Set(layers.map(layerKey))
    const labelled = departments
      .filter((d) => !d.hidden || picked.has(layerKey({ kind: 'department', id: d.id })))
      .map((d) => ({ id: d.id, code: d.code ?? '' }))
    return layerSelectionLabel(layers, labelled)
  }
}

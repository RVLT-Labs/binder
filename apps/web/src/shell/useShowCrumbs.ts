import { useQuery } from '@powersync/react'
import { useMatches, useParams, useSearch } from '@tanstack/react-router'
import type { Crumb } from './types'

const LEAF_LABELS: Record<string, string> = {
  '/shows/$showId/cues': 'Cue lists',
  '/shows/$showId/docs/': 'Documents',
  '/shows/$showId/activity': 'Activity',
  '/shows/$showId/exports': 'Exports',
  '/shows/$showId/settings': 'Settings',
  '/shows/$showId/more': 'More',
}

/**
 * The top bar's trail inside a show, from the route in view: Shows, the show (a link, except on its
 * own page), then the screen, or for a document its title (and Compare).
 */
export function useShowCrumbs(showId: string, showTitle: string | undefined): Crumb[] {
  const leaf = useMatches({ select: (matches) => matches.at(-1)?.routeId })
  const { docId } = useParams({ strict: false })
  // The version on screen: the one the URL names, else the document's current one.
  const shown = useSearch({ strict: false, select: (s) => (s as { v?: string }).v }) ?? null
  const { data: docs } = useQuery<{ title: string | null; version_number: number | null }>(
    `SELECT d.title AS title, v.version_number AS version_number FROM documents d
     LEFT JOIN document_versions v ON v.id = COALESCE(?, d.current_version_id)
     WHERE d.id = ?`,
    [shown, docId ?? ''],
  )
  const docTitle = docs[0]?.title ?? 'Document'
  const versionNumber = docs[0]?.version_number ?? null

  // The phone's back button says "Shows". Desktop and tablet draw it only on the show's own page
  // (the mockup's "Shows / Songs for a New World"); elsewhere the rail's Shows item is the way back.
  const shows = (visible: boolean): Crumb => ({
    label: 'Shows',
    link: { to: '/' },
    phoneOnly: !visible,
    backLabel: true,
  })
  // Exports and Settings are reached from More on the phone, so that is where back goes.
  const more: Crumb = {
    label: 'More',
    link: { to: '/shows/$showId/more', params: { showId } },
    phoneOnly: true,
    backLabel: true,
  }
  const show = (current: boolean): Crumb => ({
    label: showTitle ?? 'Show',
    link: current ? undefined : { to: '/shows/$showId', params: { showId } },
  })

  if (leaf === '/shows/$showId/' || leaf === '/shows/$showId') return [shows(true), show(true)]
  if (leaf === '/shows/$showId/docs/$docId')
    return [
      shows(false),
      show(false),
      {
        label: docTitle,
        // the phone's title is the mockup's "Libretto v2"; the trail has the version as a chip
        phoneLabel: versionNumber === null ? docTitle : `${docTitle} v${versionNumber}`,
      },
    ]
  if (leaf === '/shows/$showId/docs/$docId/compare' && docId) {
    return [
      shows(false),
      show(false),
      { label: docTitle, link: { to: '/shows/$showId/docs/$docId', params: { showId, docId } } },
      { label: 'Compare' },
    ]
  }
  const label = (leaf && LEAF_LABELS[leaf]) || 'Show'
  const viaMore = leaf === '/shows/$showId/exports' || leaf === '/shows/$showId/settings'
  // the phone's title is the mockup's "Show settings"; the trail says "Settings"
  const current: Crumb =
    leaf === '/shows/$showId/settings' ? { label, phoneLabel: 'Show settings' } : { label }
  return viaMore ? [shows(false), show(false), more, current] : [shows(false), show(false), current]
}

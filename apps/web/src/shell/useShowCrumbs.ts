import { useQuery } from '@powersync/react'
import { useMatches, useParams } from '@tanstack/react-router'
import type { Crumb } from './types'

const LEAF_LABELS: Record<string, string> = {
  '/shows/$showId/cues': 'Cues',
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
  const { data: docs } = useQuery<{ title: string | null }>(
    'SELECT title FROM documents WHERE id = ?',
    [docId ?? ''],
  )
  const docTitle = docs[0]?.title ?? 'Document'

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
  if (leaf === '/shows/$showId/docs/$docId') return [shows(false), show(false), { label: docTitle }]
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
  return viaMore
    ? [shows(false), show(false), more, { label }]
    : [shows(false), show(false), { label }]
}

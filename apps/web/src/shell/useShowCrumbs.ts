import { useQuery } from '@powersync/react'
import { useMatches, useParams } from '@tanstack/react-router'
import type { Crumb } from './types'

const LEAF_LABELS: Record<string, string> = {
  '/shows/$showId/cues': 'Cues',
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

  const shows: Crumb = { label: 'Shows', link: { to: '/' }, phoneOnly: true }
  const show = (current: boolean): Crumb => ({
    label: showTitle ?? 'Show',
    link: current ? undefined : { to: '/shows/$showId', params: { showId } },
  })

  if (leaf === '/shows/$showId/' || leaf === '/shows/$showId') return [shows, show(true)]
  if (leaf === '/shows/$showId/docs/$docId') return [shows, show(false), { label: docTitle }]
  if (leaf === '/shows/$showId/docs/$docId/compare' && docId) {
    return [
      shows,
      show(false),
      { label: docTitle, link: { to: '/shows/$showId/docs/$docId', params: { showId, docId } } },
      { label: 'Compare' },
    ]
  }
  return [shows, show(false), { label: (leaf && LEAF_LABELS[leaf]) || 'Show' }]
}

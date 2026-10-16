import {
  ActivityIcon,
  CuesIcon,
  DocsIcon,
  ExportsIcon,
  type IconComponent,
  ScriptIcon,
} from '@/components/icons'

export type NavKey = 'script' | 'cues' | 'docs' | 'activity' | 'exports'
/** The module hue each destination takes when it is the current one (DESIGN §6.2). */
export type NavHue = 'blue' | 'amber' | 'teal' | 'purple' | 'green'

export interface NavItem {
  key: NavKey
  label: string
  to:
    | '/shows/$showId'
    | '/shows/$showId/cues'
    | '/shows/$showId/docs'
    | '/shows/$showId/activity'
    | '/shows/$showId/exports'
  params: { showId: string }
  hue: NavHue
  icon: IconComponent
}

/** A show's destinations, in rail order. */
export function navItems(showId: string): NavItem[] {
  const params = { showId }
  return [
    { key: 'script', label: 'Script', to: '/shows/$showId', params, hue: 'blue', icon: ScriptIcon },
    {
      key: 'cues',
      label: 'Cues',
      to: '/shows/$showId/cues',
      params,
      hue: 'amber',
      icon: CuesIcon,
    },
    {
      key: 'docs',
      label: 'Docs',
      to: '/shows/$showId/docs',
      params,
      hue: 'teal',
      icon: DocsIcon,
    },
    {
      key: 'activity',
      label: 'Activity',
      to: '/shows/$showId/activity',
      params,
      hue: 'purple',
      icon: ActivityIcon,
    },
    {
      key: 'exports',
      label: 'Exports',
      to: '/shows/$showId/exports',
      params,
      hue: 'green',
      icon: ExportsIcon,
    },
  ]
}

/**
 * Which destination the URL is in. A document is the script, so Script stays current inside one;
 * the show's own page counts as Script too. Settings and the rest belong to none.
 */
export function activeNavKey(pathname: string): NavKey | 'more' | null {
  const m = /^\/shows\/[^/]+(?:\/(.*?))?\/?$/.exec(pathname)
  if (!m) return null
  const rest = m[1] ?? ''
  if (rest === '' || rest.startsWith('docs/')) return 'script'
  if (rest === 'docs') return 'docs'
  if (rest === 'cues' || rest === 'activity' || rest === 'exports' || rest === 'more') return rest
  return null
}

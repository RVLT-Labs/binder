import { formatCueNumber } from '@binder/core'
import { deptChrome, layerKey, type NumberFormat } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { modLabel } from '@/lib/modKey'
import { recordJump } from '../calling/callingHistory'
import { parseAnchor } from '../markup/rows'
import { useDepartments } from '../markup/useDepartments'
import { useLayers } from '../markup/useLayers'
import { useDocumentSearch } from '../search/useDocumentSearch'
import { type MatchableCue, type MatchableDepartment, matchCues, parseCueQuery } from './matchCues'
import { paletteOpener, usePaletteHost } from './paletteState'
import { useCanRenumber } from './useCanRenumber'

export type PaletteIcon = 'cue' | 'page' | 'search' | 'print' | 'cues' | 'eye' | 'eye-off'

/** One run of text in a result row. Parts sit a gap apart unless one is `joined` to the one before. */
export interface ResultPart {
  text: string
  /** Geist Mono, tabular: cue numbers, page numbers, the searched text. */
  mono?: boolean
  bold?: boolean
  /** A department's chrome colour, from data. */
  colour?: string
  /** The quieter ink the Cues group sets its labels in. */
  dim?: boolean
  faint?: boolean
  joined?: boolean
}

export interface Result {
  id: string
  /** The row as plain text: what a screen reader and the tests read. */
  label: string
  /** The quiet text at the right: `p.1`, `of 43`, `search`. */
  detail?: string
  /** A shortcut the action has, as a key cap: `⌘P`. */
  hint?: string
  icon: PaletteIcon
  parts: ResultPart[]
  run(): void
}

/** The four groups, in the order they are always drawn (DESIGN §7): results never reshuffle. */
export interface PaletteGroups {
  goTo: Result[]
  cues: Result[]
  script: Result[]
  actions: Result[]
}

export interface PaletteCue extends MatchableCue {
  id: string
  label: string
  anchor: { documentId: string; pageIndex: number; y: number } | null
}

export interface PaletteDepartment extends MatchableDepartment {
  /** The stored colour, or null when the department has none. */
  colour: string | null
  /** Hidden for everyone (a show setting): its cues and layer are not offered. */
  hidden: boolean
}

export interface PaletteInput {
  query: string
  cues: readonly PaletteCue[]
  departments: readonly PaletteDepartment[]
  /** Department ids whose layer this user has hidden. */
  hiddenLayers: ReadonlySet<string>
  /** The open document, or null outside one. `calling`: it is in Calling mode (DESIGN §9). */
  document: { pageCount: number; calling?: boolean } | null
  /** How many lines of the open document contain the query, once the search has answered. */
  scriptLines: number | null
  canRenumber: boolean
}

export interface PaletteEnv {
  goToCue(cue: PaletteCue): void
  goToPage(index: number): void
  searchScript(query: string): void
  print(): void
  toggleCalling(): void
  renumber(): void
  setLayerHidden(departmentId: string, hidden: boolean): void
}

const GO_TO_CUES = 3
const CUES = 8
/** Shortest text worth searching the script for. */
export const MIN_SCRIPT_QUERY = 2

/**
 * The text "In the script" searches for. A cue-shaped query ("lx 12") searches its number ("12"),
 * since a script has no "lx 12" in it; "lx" alone has no number and searches nothing. Words search as
 * typed. Null when there is too little to search for.
 */
export function scriptQueryOf(
  query: string,
  departments: readonly MatchableDepartment[],
): string | null {
  const q = query.trim()
  const parsed = parseCueQuery(q, departments)
  const text = parsed ? parsed.prefix : q
  return text.length >= MIN_SCRIPT_QUERY ? text : null
}

/** "p12", "page 12", "p. 12": a page, said as one. */
const PAGE_WORDS = /^p(?:age)?\.?\s*(\d+)$/

const pageOf = (cue: PaletteCue) => (cue.anchor ? `p.${cue.anchor.pageIndex + 1}` : undefined)

/**
 * The palette's four groups for a typed query (pure, so it is tested without a database).
 * Go to: the cue whose number is exactly the one typed, and the page of that number. Cues: the
 * rest of the cues whose number starts with it (or, for words, whose label contains them). In the
 * script: how many lines of the open document contain the text. Actions: what can be done here.
 */
export function buildPaletteResults(input: PaletteInput, env: PaletteEnv): PaletteGroups {
  const { document: doc } = input
  const query = input.query.trim()
  const visible = input.departments.filter((d) => !d.hidden)
  const departments = new Map(visible.map((d) => [d.id, d]))
  const cues = input.cues.filter((c) => departments.has(c.departmentId))
  const parsed = parseCueQuery(query, visible)

  const cueResult = (cue: PaletteCue, dim: boolean): Result => {
    const department = departments.get(cue.departmentId)
    const number = formatCueNumber(cue.major, cue.minor, department?.numberFormat ?? 'decimal')
    const code = `${department?.code ?? ''} ${number}`.trim()
    const label = cue.label.trim()
    return {
      id: `cue:${cue.id}`,
      label: label ? `${code} · ${label}` : code,
      detail: pageOf(cue),
      icon: 'cue',
      parts: [
        {
          text: code,
          mono: true,
          bold: true,
          colour: department?.colour ? deptChrome(department.colour) : undefined,
        },
        ...(label
          ? [
              { text: '·', faint: true },
              { text: label, dim },
            ]
          : []),
      ],
      run: () => env.goToCue(cue),
    }
  }

  const goTo: Result[] = []
  const found: Result[] = []
  if (parsed) {
    const exact = (cue: PaletteCue) =>
      parsed.prefix !== '' &&
      formatCueNumber(
        cue.major,
        cue.minor,
        departments.get(cue.departmentId)?.numberFormat ?? 'decimal',
      ) === parsed.prefix
    const matches = matchCues(query, cues, visible)
    const exactMatches = matches.filter(exact)
    // Exact matches past the few Go to has room for join the rest under Cues, in reading order.
    const direct = exactMatches.slice(0, GO_TO_CUES)
    goTo.push(...direct.map((c) => cueResult(c, false)))
    found.push(...matches.filter((c) => !direct.includes(c)).map((c) => cueResult(c, true)))
  } else if (query.length >= MIN_SCRIPT_QUERY) {
    const words = query.toLowerCase().split(/\s+/)
    const sorted = [...cues]
      .filter((c) => c.anchor !== null && words.every((w) => c.label.toLowerCase().includes(w)))
      .sort(
        (a, b) =>
          (a.anchor?.pageIndex ?? 0) - (b.anchor?.pageIndex ?? 0) ||
          (b.anchor?.y ?? 0) - (a.anchor?.y ?? 0),
      )
    found.push(...sorted.map((c) => cueResult(c, true)))
  }

  // A page, from a plain number ("12", or "lx 12" as the mockup has it) or from "p12" / "page 12".
  const pageText =
    PAGE_WORDS.exec(query.toLowerCase())?.[1] ??
    (/^\d+$/.test(parsed?.prefix ?? '') ? parsed?.prefix : undefined)
  const page = pageText === undefined ? null : Number(pageText)
  if (doc && page !== null && page >= 1 && page <= doc.pageCount) {
    goTo.push({
      id: `page:${page}`,
      label: `Page ${page}`,
      detail: `of ${doc.pageCount}`,
      icon: 'page',
      parts: [{ text: 'Page' }, { text: String(page), mono: true, bold: true }],
      run: () => env.goToPage(page - 1),
    })
  }

  const script: Result[] = []
  const scriptText = scriptQueryOf(query, visible)
  if (doc && scriptText !== null && input.scriptLines !== null && input.scriptLines > 0) {
    const n = input.scriptLines
    script.push({
      id: 'script',
      label: `${n} ${n === 1 ? 'line contains' : 'lines contain'} “${scriptText}”`,
      detail: 'search',
      icon: 'search',
      parts: [
        { text: String(n), mono: true },
        { text: ` ${n === 1 ? 'line contains' : 'lines contain'} “`, joined: true },
        { text: scriptText, mono: true, joined: true },
        { text: '”', joined: true },
      ],
      run: () => env.searchScript(scriptText),
    })
  }

  const actions: Result[] = []
  if (doc) {
    const label = doc.calling ? 'Switch to markup mode' : 'Switch to calling mode'
    actions.push({
      id: 'action:calling',
      label,
      hint: '⇧C',
      icon: 'page',
      parts: [{ text: label }],
      run: env.toggleCalling,
    })
    actions.push({
      id: 'action:print',
      label: 'Print…',
      hint: modLabel('P'),
      icon: 'print',
      parts: [{ text: 'Print…' }],
      run: env.print,
    })
  }
  if (input.canRenumber) {
    actions.push({
      id: 'action:renumber',
      label: 'Renumber from script order',
      icon: 'cues',
      parts: [{ text: 'Renumber from script order' }],
      run: env.renumber,
    })
  }
  for (const d of visible) {
    const hidden = input.hiddenLayers.has(d.id)
    const label = `${hidden ? 'Show' : 'Hide'} ${d.code} layer`
    actions.push({
      id: `action:layer:${d.id}`,
      label,
      icon: hidden ? 'eye' : 'eye-off',
      parts: [{ text: label }],
      run: () => env.setLayerHidden(d.id, !hidden),
    })
  }
  // Typing a cue number is not a search for a command, so the commands stay as they are then.
  const words = query.toLowerCase().split(/\s+/)
  const asked = query !== '' && !parsed
  const shownActions = asked
    ? actions.filter((a) => words.every((w) => a.label.toLowerCase().includes(w)))
    : actions

  return { goTo, cues: found.slice(0, CUES), script, actions: shownActions }
}

interface CueQueryRow {
  id: string
  department_id: string | null
  major: number | null
  minor: number | null
  label: string | null
  anchor: string | null
}

/**
 * The palette's results for `query` on a show (and, inside a document, that document): the cues
 * and departments come from the local database, the script text from the same search the Find
 * card uses, and every result runs through the router, the layer store or the open document.
 */
export function usePaletteResults(
  query: string,
  { showId, docId, enabled = true }: { showId: string; docId: string | null; enabled?: boolean },
): PaletteGroups {
  const navigate = useNavigate()
  const host = usePaletteHost()
  const document = host && host.documentId === docId ? host : null
  const departmentRows = useDepartments(showId)
  const layers = useLayers(showId)
  const { data: cueRows } = useQuery<CueQueryRow>(
    'SELECT id, department_id, major, minor, label, anchor FROM cues WHERE show_id = ?',
    [showId],
  )

  const cues = useMemo<PaletteCue[]>(
    () =>
      cueRows.map((r) => ({
        id: r.id,
        departmentId: r.department_id ?? '',
        major: Number(r.major ?? 0),
        minor: Number(r.minor ?? 0),
        label: r.label ?? '',
        anchor: parseAnchor(r.anchor),
      })),
    [cueRows],
  )
  const departments = useMemo<PaletteDepartment[]>(
    () =>
      departmentRows.map((d) => ({
        id: d.id,
        code: d.code ?? '',
        colour: d.colour,
        numberFormat: (d.number_format === 'point' ? 'point' : 'decimal') satisfies NumberFormat,
        hidden: Boolean(d.hidden),
      })),
    [departmentRows],
  )

  // The script: lines of the open document that contain the text, once the search has answered.
  const { search } = useDocumentSearch(document?.versionId ?? '')
  const text = scriptQueryOf(
    query,
    departments.filter((d) => !d.hidden),
  )
  const [lines, setLines] = useState<{ query: string; count: number } | null>(null)
  const searchable = enabled && document !== null && text !== null
  useEffect(() => {
    if (!searchable || text === null) {
      setLines(null)
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      search(text).then(
        (hits) => {
          if (stale) return
          const distinct = new Set(hits.map((h) => `${h.pageIndex}:${h.lineIndex}`))
          setLines({ query: text, count: distinct.size })
        },
        () => {
          if (!stale) setLines(null)
        },
      )
    }, 150)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [searchable, text, search])

  const hiddenLayers = useMemo(() => {
    const ids = new Set<string>()
    for (const d of departments) {
      if (layers.state.hidden.includes(layerKey({ kind: 'department', id: d.id }))) ids.add(d.id)
    }
    return ids
  }, [departments, layers.state.hidden])
  const canRenumber = useCanRenumber(showId)

  const store = layers.store
  const env: PaletteEnv = {
    goToCue(cue) {
      if (!cue.anchor) return
      // A cue on a layer you have hidden would not be drawn, so there would be nothing to select.
      const key = layerKey({ kind: 'department', id: cue.departmentId })
      if (store.get().hidden.includes(key)) store.setHidden(key, false)
      const department = departments.find((d) => d.id === cue.departmentId)
      const number = formatCueNumber(cue.major, cue.minor, department?.numberFormat ?? 'decimal')
      recordJump(cue.anchor.documentId, {
        kind: 'cue',
        cueId: cue.id,
        label: `${department?.code ?? ''} ${number}`.trim(),
      })
      void navigate({
        to: '/shows/$showId/docs/$docId',
        params: { showId, docId: cue.anchor.documentId },
        // A jump made while calling stays in Calling mode.
        search: {
          cue: cue.id,
          p: cue.anchor.pageIndex + 1,
          ...(host?.calling ? { mode: 'calling' as const } : {}),
        },
      })
    },
    goToPage: (index) => {
      if (document)
        recordJump(document.documentId, { kind: 'page', index, label: `p.${index + 1}` })
      document?.goToPage(index)
    },
    toggleCalling: () => document?.toggleCalling(),
    searchScript: (q) => document?.searchFor(q),
    print: () => document?.openPrint(paletteOpener()),
    renumber: () =>
      void navigate({
        to: '/shows/$showId/cues',
        params: { showId },
        search: { renumber: true },
      }),
    setLayerHidden: (departmentId, hidden) =>
      store.setHidden(layerKey({ kind: 'department', id: departmentId }), hidden),
  }

  return buildPaletteResults(
    {
      query,
      cues,
      departments,
      hiddenLayers,
      document: document ? { pageCount: document.pageCount, calling: document.calling } : null,
      scriptLines: lines && lines.query === text ? lines.count : null,
      canRenumber,
    },
    env,
  )
}

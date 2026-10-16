import type { DocHit } from '@binder/core'
import { type KeyboardEvent, type Ref, useEffect, useRef, useState } from 'react'

/** How long typing rests before a search runs; Enter searches at once. */
const TYPE_DELAY_MS = 200
/** searchDocument's default cap; reaching it means there may be more. */
const HIT_LIMIT = 200

export interface SearchPanelProps {
  search: (query: string) => Promise<DocHit[]>
  /** The document's words are still loading. */
  loading: boolean
  /** Pages that cannot be searched. */
  unavailable: number
  /** The hits of the last search, in page order. */
  hits: readonly DocHit[]
  /** The hit being looked at, or null. */
  active: number | null
  /** A search finished. `jump` asks to go to its first hit (Enter was what started it). */
  onResults: (hits: DocHit[], jump: boolean) => void
  /** Go to hit `index`. */
  onActivate: (index: number) => void
  /** The search box, so the `/` key and the strip's find button can focus it. */
  inputRef?: Ref<HTMLInputElement>
}

/**
 * The search box and its results. Results follow typing; Enter goes to the next hit (the first,
 * if none is current), wrapping at the end; clicking a hit goes to it.
 */
export function SearchPanel({
  search,
  loading,
  unavailable,
  hits,
  active,
  onResults,
  onActivate,
  inputRef,
}: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The query `hits` answers; a search for anything else has not finished. */
  const answered = useRef('')
  /** Numbers each search so a slow earlier one cannot overwrite a later one. */
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  function run(text: string, jump: boolean) {
    clearTimeout(timer.current)
    const mine = ++seq.current
    setPending(true)
    setError(null)
    search(text).then(
      (found) => {
        if (mine !== seq.current) return
        answered.current = text
        setPending(false)
        onResults(found, jump)
      },
      (err: unknown) => {
        if (mine !== seq.current) return
        setPending(false)
        setError(err instanceof Error ? err.message : String(err))
      },
    )
  }

  function onChange(text: string) {
    setQuery(text)
    clearTimeout(timer.current)
    if (text.trim() === '') {
      seq.current++
      answered.current = ''
      setPending(false)
      setError(null)
      onResults([], false)
      return
    }
    timer.current = setTimeout(() => run(text, false), TYPE_DELAY_MS)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (query.trim() === '') return
    if (answered.current === query && hits.length > 0)
      onActivate(((active ?? -1) + 1) % hits.length)
    else run(query, true)
  }

  const searched = query.trim() !== '' && answered.current === query && !pending
  const status = loading
    ? 'Loading the document text…'
    : pending
      ? 'Searching…'
      : searched
        ? hits.length === 0
          ? 'No results'
          : `${hits.length >= HIT_LIMIT ? `${HIT_LIMIT}+` : hits.length} ${hits.length === 1 ? 'result' : 'results'}`
        : ''

  return (
    <aside className="search-panel" aria-label="Search">
      <input
        ref={inputRef}
        type="search"
        aria-label="Search document"
        placeholder="Search this document"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <p role="status" className="search-status">
        {status}
      </p>
      {unavailable > 0 && (
        <p className="search-unavailable">
          {unavailable} {unavailable === 1 ? 'page' : 'pages'} could not be searched.
        </p>
      )}
      {error && (
        <p role="alert" className="search-error">
          Search failed: {error}
        </p>
      )}
      {hits.length > 0 && query.trim() !== '' && (
        <ol aria-label="Search results" className="search-results">
          {hits.map((hit, i) => (
            <li key={`${hit.pageIndex}:${hit.lineIndex}:${hit.wordStart}`}>
              <button
                type="button"
                className="search-result"
                aria-current={i === active ? 'true' : undefined}
                onClick={() => onActivate(i)}
              >
                <span className="search-result-page">Page {hit.pageIndex + 1}</span>
                <span className="search-result-snippet">{hit.snippet}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}

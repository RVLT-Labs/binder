import type { DocHit } from '@binder/core'
import { type KeyboardEvent, type Ref, useEffect, useRef, useState } from 'react'
import { CloseIcon, SearchIcon } from '@/components/icons'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

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
  /** Text to search for as soon as it arrives (the command palette's "In the script"); each new `n` runs again. */
  seed?: { text: string; n: number } | null
  /** Escape or the close button: the card hides and the highlights go. */
  onClose?: () => void
  className?: string
}

/**
 * The Find card (the strip's Find tool, or `/`): the search box and its results. Results follow
 * typing; Enter goes to the next hit (the first, if none is current), wrapping at the end; clicking
 * a hit goes to it. The box takes focus when the card opens.
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
  seed,
  onClose,
  className,
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
  const box = useRef<HTMLInputElement | null>(null)
  // The card opens with the cursor in the box, from the strip's button or the `/` key.
  useEffect(() => box.current?.focus(), [])

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

  const seeded = useRef(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new seed runs a search; `run` reads current state
  useEffect(() => {
    if (!seed || seeded.current === seed.n) return
    seeded.current = seed.n
    setQuery(seed.text)
    run(seed.text, true)
  }, [seed])

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
    if (e.key === 'Escape' && onClose) {
      // Handled here: the markup keys' Escape (deselect) must not also run.
      e.preventDefault()
      onClose()
      return
    }
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
    <aside
      className={cn(
        'search-panel flex flex-col gap-2 rounded-[12px] border-2 border-line-2 bg-card p-2.5 shadow-card',
        className,
      )}
      aria-label="Search"
    >
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
          />
          <Input
            ref={(el) => {
              box.current = el
              if (typeof inputRef === 'function') inputRef(el)
              else if (inputRef) inputRef.current = el
            }}
            type="search"
            aria-label="Search document"
            placeholder="Search this document"
            className="pl-10 md:pl-8 [&::-webkit-search-cancel-button]:hidden"
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Close search"
            className="grid size-8 shrink-0 place-items-center rounded-[8px] text-muted hover:bg-elev hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red max-md:size-11"
            onClick={onClose}
          >
            <CloseIcon aria-hidden className="size-4" strokeWidth={1.8} />
          </button>
        )}
      </div>
      <p role="status" className="search-status m-0 min-h-[1em] text-[12px] text-muted">
        {status}
      </p>
      {unavailable > 0 && (
        <p className="search-unavailable m-0 text-[12px] text-muted">
          {unavailable} {unavailable === 1 ? 'page' : 'pages'} could not be searched.
        </p>
      )}
      {error && (
        <p role="alert" className="search-error m-0 text-[12px] text-t-out">
          Search failed: {error}
        </p>
      )}
      {hits.length > 0 && query.trim() !== '' && (
        <ol
          aria-label="Search results"
          className="search-results m-0 max-h-[min(50dvh,22rem)] list-none overflow-y-auto p-0"
        >
          {hits.map((hit, i) => (
            <li key={`${hit.pageIndex}:${hit.lineIndex}:${hit.wordStart}`}>
              <button
                type="button"
                className="search-result grid w-full gap-0.5 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red aria-[current=true]:bg-elev max-md:min-h-11"
                aria-current={i === active ? 'true' : undefined}
                onClick={() => onActivate(i)}
              >
                <span className="search-result-page font-mono text-[11px] text-faint">
                  Page {hit.pageIndex + 1}
                </span>
                <span className="search-result-snippet text-ink-2">{hit.snippet}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}

import { Command } from 'cmdk'
import { useEffect, useRef, useState } from 'react'
import {
  CloseIcon,
  CuesIcon,
  CueTagIcon,
  EyeIcon,
  EyeOffIcon,
  type IconComponent,
  PrintIcon,
  ScriptIcon,
  SearchIcon,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { closeModal, modalIsOpen, openModal } from '@/lib/modalDialog'
import { cn } from '@/lib/utils'
import {
  closePalette,
  dismissPalette,
  isPaletteOpen,
  openPalette,
  paletteOpener,
  usePaletteHost,
  usePaletteOpen,
} from './paletteState'
import {
  type PaletteGroups,
  type PaletteIcon,
  type Result,
  type ResultPart,
  usePaletteResults,
} from './usePaletteResults'

const ICONS: Record<PaletteIcon, IconComponent> = {
  cue: CueTagIcon,
  page: ScriptIcon,
  search: SearchIcon,
  print: PrintIcon,
  cues: CuesIcon,
  eye: EyeIcon,
  'eye-off': EyeOffIcon,
}

/** The four groups, always in this order (DESIGN §7). */
const GROUPS: Array<[key: keyof PaletteGroups, heading: string]> = [
  ['goTo', 'Go to'],
  ['cues', 'Cues'],
  ['script', 'In the script'],
  ['actions', 'Actions'],
]

/**
 * ⌘K (Ctrl+K elsewhere) opens the command palette on a show's screens: a cue number, a page, a line
 * of script or an action (DESIGN §7). The palette's own body mounts only while it is open.
 */
export function CommandPalette({ showId }: { showId: string }) {
  const open = usePaletteOpen()
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      // Another dialog (Print, Renumber) is its own context; the palette does not stack on it.
      if (!isPaletteOpen() && modalIsOpen()) return
      e.preventDefault()
      if (e.repeat) return
      if (isPaletteOpen()) dismissPalette()
      else openPalette()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  // A new show starts from a closed palette.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the show changing is what closes it
  useEffect(() => closePalette, [showId])
  return open ? <PaletteBody showId={showId} /> : null
}

/** The phone's top bar button: there is no ⌘K on a touch screen, so the palette opens from here. */
export function PaletteButton({ className }: { className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Command palette"
      className={cn('shrink-0', className)}
      onClick={openPalette}
    >
      <SearchIcon className="!size-[22px]" />
    </Button>
  )
}

function PaletteBody({ showId }: { showId: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const host = usePaletteHost()
  const [query, setQuery] = useState('')
  const groups = usePaletteResults(query, { showId, docId: host?.documentId ?? null })
  // The current result: the first one, until the arrow keys or the pointer pick another. It is
  // kept here (not left to cmdk) because the list is rebuilt as you type, and the current result
  // of the last query must not stay current when it is no longer the first.
  const [picked, setPicked] = useState('')
  const flat = GROUPS.flatMap(([key]) => groups[key])
  const current = flat.some((r) => r.id === picked) ? picked : (flat[0]?.id ?? '')
  /** Running a result hands focus back itself (and the result may move it on): close must not. */
  const ran = useRef(false)

  useEffect(() => {
    if (!dialog.current) return
    openModal(dialog.current)
    // Not left to the dialog: it would offer the list's own wrapper (tabindex -1) before the box.
    input.current?.focus()
  }, [])

  function dismiss() {
    if (ran.current) closePalette()
    else dismissPalette()
  }

  function run(result: Result) {
    ran.current = true
    closeModal(dialog.current, paletteOpener())
    closePalette()
    result.run()
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click is the scrim's; Escape is the keyboard's way out
    <dialog
      ref={dialog}
      aria-label="Command palette"
      // Escape, and anything else that closes the native dialog, ends here.
      onClose={dismiss}
      onClick={(e) => {
        // The dialog has no padding: a click that lands on it itself is a click on the scrim.
        if (e.target === e.currentTarget) dialog.current?.close()
      }}
      className={cn(
        // 640 px wide, 72 px from the top, 20 px radius, the dialog shadow; the scrim dims the page behind.
        'm-0 mx-auto mt-[72px] w-[640px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[20px] border-2 border-line-2 bg-card p-0 text-ink shadow-dialog backdrop:bg-scrim',
        'open:flex open:max-h-[calc(100dvh-144px)] open:flex-col',
        // phone: the whole screen
        'max-md:mt-0 max-md:h-dvh max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:pt-[env(safe-area-inset-top)] max-md:pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)] max-md:shadow-none max-md:open:max-h-none',
      )}
    >
      <Command
        shouldFilter={false}
        value={current}
        onValueChange={setPicked}
        loop
        label="Command palette"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line px-[18px] text-muted max-md:h-14 max-md:pr-2">
          <SearchIcon aria-hidden className="size-5 shrink-0" />
          <Command.Input
            value={query}
            ref={input}
            onValueChange={(text) => {
              setQuery(text)
              setPicked('')
            }}
            placeholder="Cue, page, script text or action"
            className="min-w-0 flex-1 bg-transparent font-mono text-[18px] max-md:h-11 text-ink caret-ink outline-none placeholder:font-sans placeholder:text-[15px] placeholder:text-muted"
          />
          <span aria-hidden className="max-md:hidden">
            <Kbd>esc</Kbd>
          </span>
          <button
            type="button"
            aria-label="Close"
            className="grid size-11 shrink-0 place-items-center rounded-[12px] text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red md:hidden"
            onClick={() => dialog.current?.close()}
          >
            <CloseIcon aria-hidden className="size-5" />
          </button>
        </div>
        <Command.List className="min-h-0 flex-1 overflow-y-auto pb-1.5 max-md:pb-[max(6px,env(safe-area-inset-bottom))]">
          <Command.Empty className="px-[18px] py-6 text-[14px] text-muted">
            No results
          </Command.Empty>
          {GROUPS.map(([key, heading]) =>
            groups[key].length === 0 ? null : (
              <Command.Group
                key={key}
                heading={heading}
                className="[&_[cmdk-group-heading]]:px-[18px] [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted"
              >
                {groups[key].map((result) => (
                  <ResultRow key={result.id} result={result} onRun={run} />
                ))}
              </Command.Group>
            ),
          )}
        </Command.List>
        <div className="flex h-[38px] shrink-0 items-center border-t border-line bg-paper-2 px-[18px] font-mono text-[11px] text-muted max-md:hidden">
          ↑↓ move · ↵ open · esc close
        </div>
      </Command>
    </dialog>
  )
}

export function ResultRow({ result, onRun }: { result: Result; onRun: (r: Result) => void }) {
  const Icon = ICONS[result.icon]
  return (
    <Command.Item
      value={result.id}
      onSelect={() => onRun(result)}
      className={cn(
        // Fine desktop rows stay 38px; coarse rows reserve 44px and 8px of neighbour space.
        'group/item flex h-[38px] cursor-default items-center gap-3 px-[18px] text-[14px] text-ink outline-none max-md:h-11 [@media(pointer:coarse)]:h-auto [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:mb-2',
        'data-[selected=true]:bg-red/12 data-[selected=true]:shadow-[inset_3px_0_0_var(--red)]',
      )}
    >
      <Icon
        aria-hidden
        className="size-[18px] shrink-0 text-muted group-data-[selected=true]/item:text-ink"
      />
      <span className="flex min-w-0 flex-1 items-center">
        {result.parts.map((part, i) => (
          // a row's parts never reorder
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
          <Part key={`${i}:${part.text}`} part={part} first={i === 0} />
        ))}
      </span>
      {result.detail && (
        <span className="shrink-0 font-mono text-[12px] text-muted">{result.detail}</span>
      )}
      {result.hint && (
        <span aria-hidden className="shrink-0 max-md:hidden">
          <Kbd>{result.hint}</Kbd>
        </span>
      )}
      <span
        aria-hidden
        className="ml-1.5 hidden shrink-0 md:group-data-[selected=true]/item:inline-flex"
      >
        <Kbd>↵</Kbd>
      </span>
    </Command.Item>
  )
}

function Part({ part, first }: { part: ResultPart; first: boolean }) {
  return (
    <span
      className={cn(
        // a code (the cue or page number) keeps its width; the words after it give way and truncate
        part.bold ? 'shrink-0' : 'min-w-0 overflow-hidden text-ellipsis',
        part.mono && 'font-mono tabular-nums',
        part.bold && 'font-semibold',
        part.colour && 'inline-flex items-center gap-1.5 text-ink',
        part.dim && 'text-ink-2',
        part.faint && 'text-muted',
        'whitespace-pre',
        !first && !part.joined && 'ml-2',
      )}
    >
      {part.colour && (
        <i
          aria-hidden
          className="inline-block size-2.5 shrink-0 rounded-[3px]"
          style={{ background: part.colour }}
        />
      )}
      {part.text}
    </span>
  )
}

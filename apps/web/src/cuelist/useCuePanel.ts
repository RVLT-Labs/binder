import { useCallback, useRef, useState } from 'react'

export type CuePanelTab = 'cue' | 'history'

export interface CuePanel {
  /** The cue the panel shows, or null. */
  selectedId: string | null
  /** The cue that was selected until a moment ago: what a closing sheet hands focus back to. */
  lastSelectedId: string | null
  tab: CuePanelTab
  setTab: (tab: CuePanelTab) => void
  /** Tablet sheet and phone drawer: whether it is drawn. (The desktop panel is always there.) */
  open: boolean
  /** A row or card was chosen: show it on the Cue tab. */
  select: (id: string) => void
  /** Deselect and close. */
  clear: () => void
  /** The sheet or drawer asked to close (Done, Escape, a drag): the cue is deselected, so its row can open it again. */
  onOpenChange: (open: boolean) => void
}

/**
 * Which cue the cue list's panel shows, which of its tabs, and whether the tablet sheet or phone
 * drawer is drawn. Choosing a cue opens it on the Cue tab; closing deselects.
 */
export function useCuePanel(): CuePanel {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<CuePanelTab>('cue')
  const [open, setOpen] = useState(false)
  const last = useRef<string | null>(null)
  if (selectedId) last.current = selectedId

  const select = useCallback((id: string) => {
    setSelectedId(id)
    setTab('cue')
    setOpen(true)
  }, [])
  const clear = useCallback(() => {
    setSelectedId(null)
    setOpen(false)
  }, [])
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) clear()
      else setOpen(true)
    },
    [clear],
  )
  return {
    selectedId,
    lastSelectedId: last.current,
    tab,
    setTab,
    open,
    select,
    clear,
    onOpenChange,
  }
}

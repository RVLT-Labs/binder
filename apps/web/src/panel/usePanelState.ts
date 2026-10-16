import { useCallback, useEffect, useRef, useState } from 'react'
import { clearSelection, useSelection } from '../markup/selection'

export type PanelTabId = 'cue' | 'layers' | 'history' | 'review'

export interface PanelState {
  tab: PanelTabId
  setTab: (tab: PanelTabId) => void
  /** Tablet sheet and phone drawer: whether it is drawn. (The desktop panel is always there.) */
  open: boolean
  /** A control chose a tab (the phone menu's Layers, "N to review"): opens it on that tab. */
  openTab: (tab: PanelTabId) => void
  /** The tablet's top bar toggle. */
  toggle: () => void
  /** Who opened the panel now: a selection (the tag gets focus back) or a choice (the opener does). */
  openedBy: () => 'selection' | 'choice'
  /** The sheet or drawer asked to close (Escape, a drag, Done). Closing what a selection opened deselects. */
  onOpenChange: (open: boolean) => void
}

/**
 * Which tab the context panel shows and whether its sheet or drawer is drawn.
 *
 * - Selecting a cue or annotation opens it on the Cue tab (the Review tab stays: moving an item
 *   there selects it, and the hint under it must stay in view). Deselecting closes what the
 *   selection opened, and only that: a panel someone opened by choosing a tab stays.
 * - `review` (the `?review=` address the overview's Needs you link and a finished upload use) opens
 *   it on the Review tab, once; `onReviewHandled` is then called so the address can drop it.
 */
export function usePanelState({
  review,
  onReviewHandled,
}: {
  review: boolean
  onReviewHandled: () => void
}): PanelState {
  const selection = useSelection()
  const selected = selection ? `${selection.table}:${selection.id}` : null
  const [tab, setTab] = useState<PanelTabId>('cue')
  const [open, setOpen] = useState(false)
  /** Who opened the panel: a selection (which closing it again undoes) or a choice. */
  const openedBy = useRef<'selection' | 'choice'>('choice')
  const isOpen = useRef(open)
  isOpen.current = open
  const lastSelected = useRef<string | null>(null)

  useEffect(() => {
    if (selected === lastSelected.current) return
    const had = lastSelected.current
    lastSelected.current = selected
    if (selected) {
      setTab((t) => (t === 'review' ? t : 'cue'))
      if (!isOpen.current) {
        openedBy.current = 'selection'
        setOpen(true)
      }
    } else if (had && openedBy.current === 'selection') {
      setOpen(false)
    }
  }, [selected])

  useEffect(() => {
    if (!review) return
    setTab('review')
    openedBy.current = 'choice'
    setOpen(true)
    onReviewHandled()
  }, [review, onReviewHandled])

  const openTab = useCallback((next: PanelTabId) => {
    setTab(next)
    openedBy.current = 'choice'
    setOpen(true)
  }, [])
  const toggle = useCallback(() => {
    openedBy.current = 'choice'
    setOpen((o) => !o)
  }, [])
  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next && openedBy.current === 'selection') clearSelection()
  }, [])

  const getOpenedBy = useCallback(() => openedBy.current, [])
  return { tab, setTab, open, openTab, toggle, openedBy: getOpenedBy, onOpenChange }
}

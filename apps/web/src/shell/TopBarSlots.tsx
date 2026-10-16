import { createContext, type ReactNode, useContext } from 'react'
import { createPortal } from 'react-dom'

/** The places a screen can put its own controls in the top bar. */
export interface TopBarSlotElements {
  /** Right after the breadcrumbs: a chip that belongs to the trail, e.g. the version. */
  chip: HTMLElement | null
  /** The right-hand cluster, between sync state and the primary action. */
  actions: HTMLElement | null
  /** Phone only, on a screen that supplies its own bar (the script): after the title. */
  phone: HTMLElement | null
}

export const TopBarSlotsContext = createContext<TopBarSlotElements>({
  chip: null,
  actions: null,
  phone: null,
})

/**
 * Draws `children` in a top bar slot. The screen keeps ownership of the controls (their state, its
 * providers), the shell only says where they sit. Nothing is drawn where the bar has no slot (phone).
 */
function InSlot({ slot, children }: { slot: keyof TopBarSlotElements; children: ReactNode }) {
  const el = useContext(TopBarSlotsContext)[slot]
  return el ? createPortal(children, el) : null
}

export const TopBarChip = ({ children }: { children: ReactNode }) => (
  <InSlot slot="chip">{children}</InSlot>
)
export const TopBarActions = ({ children }: { children: ReactNode }) => (
  <InSlot slot="actions">{children}</InSlot>
)
/** The phone bar's own controls (see `TopBar`'s `bare`): the script's page position and menu. */
export const TopBarPhone = ({ children }: { children: ReactNode }) => (
  <InSlot slot="phone">{children}</InSlot>
)

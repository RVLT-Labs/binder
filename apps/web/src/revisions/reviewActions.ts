export type ReviewActionKind = 'accept' | 'move' | 'revert' | 'reanchor'

export interface ReviewAction {
  kind: ReviewActionKind
  label: string
  /** Why the action is unavailable, or null when it can be used. */
  disabled: string | null
}

export const NO_EARLIER_POSITION = 'No earlier position: a revision never moved this item.'

/**
 * The buttons a review item offers. A pending item (on the current version) can be accepted, moved
 * or sent back to where it was; one still on an older version can be re-anchored or moved. A user who
 * may not edit the item's layer sees every button disabled with the session's reason.
 */
export function reviewItemActions(input: {
  section: 'pending' | 'older'
  hasPrevious: boolean
  whyCantEdit: string | null
}): ReviewAction[] {
  const { whyCantEdit } = input
  const make = (
    kind: ReviewActionKind,
    label: string,
    own: string | null = null,
  ): ReviewAction => ({
    kind,
    label,
    disabled: whyCantEdit ?? own,
  })
  if (input.section === 'older') return [make('reanchor', 'Re-anchor'), make('move', 'Move')]
  return [
    make('accept', 'Accept'),
    make('move', 'Move'),
    make('revert', 'Revert to old version', input.hasPrevious ? null : NO_EARLIER_POSITION),
  ]
}

import { EMPTY_PRESENCE_STATE, type PresencePeer, type PresenceState } from '@binder/shared'
import { useContext, useEffect } from 'react'
import { PresenceContext } from './PresenceProvider'

/**
 * Says where this tab is in the show and returns who else is there. The connection belongs to the
 * enclosing PresenceProvider (one socket per tab); this only sets what the tab says, and resets it
 * to "in the show, nowhere in particular" when the caller unmounts. Offline, or outside a provider
 * for this show, there are no peers and nothing is sent.
 */
export function usePresence(
  showId: string,
  state: PresenceState,
): { peers: PresencePeer[]; connected: boolean } {
  const ctx = useContext(PresenceContext)
  const mine = ctx.showId === showId
  const { setState } = ctx
  const { documentId, versionId, pageIndex } = state
  const selectionTable = state.selection?.table
  const selectionId = state.selection?.id

  useEffect(() => {
    if (!mine) return
    setState({
      documentId,
      versionId,
      pageIndex,
      selection: selectionTable && selectionId ? { table: selectionTable, id: selectionId } : null,
    })
  }, [mine, setState, documentId, versionId, pageIndex, selectionTable, selectionId])

  useEffect(() => {
    if (!mine) return
    return () => setState(EMPTY_PRESENCE_STATE)
  }, [mine, setState])

  return mine ? { peers: ctx.peers, connected: ctx.connected } : { peers: [], connected: false }
}

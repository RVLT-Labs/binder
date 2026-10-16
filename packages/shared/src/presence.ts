import { z } from 'zod'

/**
 * Presence protocol (spec 3.9): who is in a show's binder, on which document and page, with what
 * selected. Clients send their state on change and every PRESENCE_HEARTBEAT_MS; the server fans it
 * out to the show and drops a connection after PRESENCE_TIMEOUT_MS of silence. Presence is
 * best-effort and silently absent offline.
 *
 * Protocol notes for clients:
 * - `welcome` lists the peers already in the show (never the receiver itself).
 * - A `peer` message for a new connection arrives when it joins, before it has said anything, so its
 *   documentId, versionId, pageIndex and selection are all null. Show such a peer as present but
 *   not located; later `peer` messages for the same connId replace its state.
 * - `leave` removes a connId. The server closes with 4401 (session ended), 4403 (no longer a member),
 *   4408 (silent too long), 4429 (too many connections), 1001 (server restarting), 1008 (too many
 *   frames) or 1009 (frame over PRESENCE_MAX_FRAME_BYTES). Reconnect after 1001 and 4408; do not
 *   after 4401, 4403 or 1008/1009.
 */

export interface PresenceSelection {
  table: 'cues' | 'annotations'
  id: string
}

export interface PresenceState {
  documentId: string | null
  versionId: string | null
  pageIndex: number | null
  selection: PresenceSelection | null
}

/**
 * One open connection as other clients see it. `colour` is a per-user colour (spec 3.9), never a
 * department colour. Nothing else about the user (no email) ever travels in presence.
 */
export interface PresencePeer extends PresenceState {
  connId: string
  userId: string
  name: string
  colour: string
}

/**
 * One person in a show as the shows home draws them (`GET /api/me/shows/presence`): name and colour
 * for the avatar, and their department scope as codes (`[]` for every department) for its tooltip.
 */
export interface ShowPresencePerson {
  userId: string
  name: string
  colour: string
  departments: string[]
}

export interface ShowPresence {
  people: ShowPresencePerson[]
}

export type ClientMessage = { type: 'state'; state: PresenceState }

export type ServerMessage =
  | { type: 'welcome'; connId: string; peers: PresencePeer[] }
  | { type: 'peer'; peer: PresencePeer }
  | { type: 'leave'; connId: string }

const id = () => z.string().min(1).max(200)

export const clientMessageSchema: z.ZodType<ClientMessage> = z.object({
  type: z.literal('state'),
  state: z.object({
    documentId: id().nullable(),
    versionId: id().nullable(),
    pageIndex: z.number().int().min(0).max(100000).nullable(),
    selection: z.object({ table: z.enum(['cues', 'annotations']), id: id() }).nullable(),
  }),
})

/** The state of a connection that has said nothing yet. */
export const EMPTY_PRESENCE_STATE: Readonly<PresenceState> = Object.freeze({
  documentId: null,
  versionId: null,
  pageIndex: null,
  selection: null,
})

export const PRESENCE_HEARTBEAT_MS = 5000
export const PRESENCE_TIMEOUT_MS = 15000
export const PRESENCE_MAX_MESSAGES_PER_SECOND = 20
export const PRESENCE_MAX_CONNECTIONS_PER_USER = 5
/** Inbound frames larger than this close the socket with 1009. */
export const PRESENCE_MAX_FRAME_BYTES = 2048

/** Twelve well-separated colours that read on both the light and dark page backgrounds. */
export const PRESENCE_PALETTE: readonly string[] = [
  '#e6194b',
  '#f58231',
  '#c9a000',
  '#3cb44b',
  '#0f9d8f',
  '#2f7de1',
  '#4363d8',
  '#911eb4',
  '#d6409f',
  '#8c564b',
  '#5f7d3a',
  '#6b7280',
]

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** A stable per-user colour: the same user is the same colour on every device and in every show. */
export function presenceColour(userId: string): string {
  return PRESENCE_PALETTE[fnv1a32(userId) % PRESENCE_PALETTE.length]
}

import { useQuery } from '@powersync/react'
import { useEffect, useState } from 'react'

/**
 * The show a person last had open on this device. The rail draws the show's destinations on the
 * shows home too (muted, none current), pointing at it, so the way back into the book is one click.
 * Per account: the local database is wiped when a different person signs in, and so is this.
 */
const key = (email: string) => `binder.lastShow.${email}`

export function rememberShow(email: string, showId: string): void {
  try {
    localStorage.setItem(key(email), showId)
  } catch {
    // storage blocked or full: the rail just has no shortcut
  }
}

export function recallShow(email: string): string | undefined {
  try {
    return localStorage.getItem(key(email)) || undefined
  } catch {
    return undefined
  }
}

/** Remembers the show the page is in, once the show is known to exist on this device (never a bogus or removed one). */
export function useRememberShow(email: string, showId: string, exists: boolean): void {
  useEffect(() => {
    if (exists) rememberShow(email, showId)
  }, [email, showId, exists])
}

/**
 * The remembered show, only while it is in the local shows list (a deleted show, or one the person
 * was removed from, draws no links). Archived shows are kept. Undefined until it is confirmed.
 */
export function useLastShowId(email: string): string | undefined {
  const [remembered] = useState(() => recallShow(email))
  const { data } = useQuery<{ id: string }>('SELECT id FROM shows WHERE id = ?', [remembered ?? ''])
  return remembered && data.some((s) => s.id === remembered) ? remembered : undefined
}

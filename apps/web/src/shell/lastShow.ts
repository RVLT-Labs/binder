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

import type { LinkOptions } from '@tanstack/react-router'

/** Asks the user a yes/no question in the page. Resolves false when they decline or dismiss it. */
export type ConfirmFn = (message: string) => Promise<boolean>

export interface Crumb {
  label: string
  /** The phone's title when it says more than the trail does ("Libretto v2"). */
  phoneLabel?: string
  /** Where the crumb goes. Leave it off for the current page. */
  link?: LinkOptions
  /** Only the phone draws it (as the back button); the rail's Shows item is that link elsewhere. */
  phoneOnly?: boolean
  /** On the phone, when this is the parent: say its name next to the back chevron ("Shows", "More"). */
  backLabel?: boolean
}

export interface Account {
  email: string
  name: string
  /** Signs the user out, asking through `confirm` first when that would lose changes. */
  signOut: (confirm: ConfirmFn) => Promise<void>
}

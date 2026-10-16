/** True on Apple platforms, where the command key is ⌘ and not Ctrl. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
}

/** A shortcut with the platform's modifier, as a key cap reads: `⌘K`, or `Ctrl K` elsewhere. */
export function modLabel(key: string): string {
  return isApplePlatform() ? `⌘${key}` : `Ctrl ${key}`
}

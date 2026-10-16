import type { DocumentEntry } from '../documents/documentEntries'

/** "Libretto v1, v2": a document and the versions of it that are ready. */
export function documentNames(entries: readonly DocumentEntry[]): string[] {
  return entries.flatMap((e) =>
    e.kind === 'ready'
      ? [
          `${e.title} ${[e.kept?.number, e.version.number]
            .filter((n) => n !== undefined)
            .map((n) => `v${n}`)
            .join(', ')}`,
        ]
      : [],
  )
}

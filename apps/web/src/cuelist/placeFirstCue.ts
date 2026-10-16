/** The document an empty cue list sends you to, if it should send you anywhere. */
export interface PlaceableDocument {
  id: string
  /** Set once a version is ready; a document with none cannot be marked up yet. */
  current_version_id: string | null
}

/**
 * Where "Place the first cue" goes: the first document with a ready version, and only when the
 * person can place cues in this department at all (`readOnly` is the cue list's reason they cannot:
 * a viewer, a department they are not in, an archived show, a locked layer). Otherwise nothing:
 * the empty state says there are no cues and offers no action it cannot keep.
 */
export function firstCueDocument(
  documents: readonly PlaceableDocument[],
  readOnly: string | null,
): string | null {
  if (readOnly !== null) return null
  return documents.find((d) => d.current_version_id)?.id ?? null
}

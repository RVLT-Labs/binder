# Annotations

Notes, shapes, arrows, stamps and highlights: what they are, where they live, and who can edit them.
Derived from `apps/api/src/mcp/tools/annotations.ts`, `apps/api/src/services/annotations.ts`, `packages/shared/src/markupSchemas.ts`, `packages/core/src/print/stampScript.ts`.

Read this when the user wants a note, mark or highlight on the script rather than a cue, or asks what someone's annotation is.

## Layers

An annotation belongs to one layer:

- a **department layer** (`layer: "LX"`, an id, or `department:<id>`): visible to every member, editable by owners and by editors whose scope includes the department. A note the whole team should see goes here, on the author's department.
- your **personal layer** (`layer: "personal"` or `personal:<your user id>`): visible to you alone, editable by you whatever your role (a viewer can only write here). There is no shared "everyone" layer.

Another member's personal layer does not exist as far as you can tell: listing it is `not_found: Layer not found`, its annotations are `not_found: Annotation not found`, writing to it is `forbidden: a personal annotation goes on your own personal layer`, and its history, exports and review items are filtered out. Never try to read or change it, and never tell the user what is on it, because you cannot know.

Moving: `update_annotation {annotationId, layer}` from personal to a department shares it (needs edit rights on the department). Department to personal is refused with `invalid: Copy it to your personal layer instead.` because it would pull shared markup out of everyone's view and history.

## Types and their fields

| `type` | `geometry` | `text` | `anchor.text` | What it means |
|---|---|---|---|---|
| `note` | `{}` | required (≤2000) | no | A text block; the anchor is its top-left corner. Prints as a tinted box with a colour bar; wraps at 160 pt. |
| `stamp` | `{}` | 1..40 chars | no | A word stamped on the page (`Blackout`, `Fly out`, `Enter`); centred on the anchor. Use the show's `settings.stampSet` list or the default seven. |
| `highlight` | `{}` | optional | required `{quote, wordStart, wordEnd}` | A fill over a range of words on one page. Needs real word indices from `get_page` or `search_script`. |
| `rect` | `{w, h}` > 0 | optional | no | A box from the anchor (bottom-left) up and right. |
| `ellipse` | `{w, h}` > 0 | optional | no | An ellipse in that box. |
| `line` | `{dx, dy}` not both 0 | optional | no | From the anchor by the offset. |
| `arrow` | `{dx, dy}` not both 0 | optional | no | The same, with the head at the end. |

`style` is `{colour?: "#RRGGBB", strokeWidth?: 0.5..12, fontSize?: 6..72}`; omitted values mean the layer colour, 1.5 pt, and 10 pt (12 pt for stamps). The personal layer's colour is grey `#6B7280`.

Geometry is in points **relative to the anchor**, so a revision that moves the anchor moves the shape with it.

## Placing

`create_annotation {showId, layer, type, anchor: {documentId, pageIndex, x, y, text?}, geometry?, text?, style?}` places on the document's **current** version. Coordinates are PDF points, origin bottom-left ([reading-scripts.md](reading-scripts.md)).

- A note beside a line: `x` just right of the text block (`textExtent.maxX + 8`, or the page's widest word's right edge), `y` the line's `y + h` so the note's top aligns with the line.
- A highlight over a line: search for it, then `anchor: {pageIndex, x: box.x, y: box.y, text: {quote, wordStart, wordEnd}}` from the hit. The quote is at most 400 characters; indices are inclusive and must be on that page.
- A box around a passage: anchor at the bottom-left word's `x - 4`, `y - 4`; `w` and `h` from the words' extent plus 8.
- A stamp at a moment: `x` in the margin or over the line, `y` at the line's centre; `text` from the stamp set.

Errors you will meet: `invalid: text: a note needs text`, `invalid: text: a stamp needs 1 to 40 characters`, `invalid: anchor: a highlight needs anchor text`, `invalid: geometry.w: Invalid input: expected number, received undefined; geometry.h: …`, `invalid: anchor pageIndex N is beyond the P pages`, `invalid: geometry: dx and dy must not both be 0`.

```json
{"id":"01a146d6-5907-7f0f-8d33-0c0b86bcdd13","layer":"personal:01a146d2-b382-71bc-ac0b-7e0a0593bc6c","layerKind":"personal","layerId":"01a146d2-…","type":"stamp","text":"Blackout",
 "anchor":{"documentId":"01a146d4-…","documentVersionId":"01a146d4-…","pageIndex":0,"x":400,"y":200,"status":"ok"},"geometry":{},"style":{}}
```

## Editing and deleting

- `update_annotation` changes any field; omitted fields stay. The merged row must still validate (a `rect` keeps `w` and `h`; a `note` keeps non-empty text). Changing `anchor` without `text` keeps a highlight's bound words.
- `delete_annotations {annotationIds}` is all or nothing; more than 10 ids needs `confirm: true`, and the gate names the layers (`This deletes 12 annotations from LX, your personal layer.`).
- Every change is logged on the annotation's layer and revertable with `revert_change` / `revert_batch`.
- A deleted annotation reads `not_found` afterwards; `revert_change` on its delete row restores it with the same id.

## Reading

- `list_annotations {showId, layer?, documentId?}` returns every department layer plus your personal layer, oldest first. Each has `layer` (key), `layerKind`, `layerId`, `type`, `anchor`, `geometry`, `text`, `style`.
- `get_annotation {annotationId}` returns one.
- To summarise "what has the SM written on page 5": list with `documentId`, filter `anchor.pageIndex === 4`, group by `layer` (map ids to codes with `list_departments`), and read `text` and `type`. For a highlight the words are `anchor.text.quote`.

## Revisions

Annotations re-anchor like cues: a highlight by its quote, everything else by page and position (`approximate` when the page count is unchanged, else `unresolved`). An unbound highlight (`wordStart: -1`) prints as a dashed marker with the first 24 characters of its quote. Resolve them from `get_reanchor_review` ([revisions-and-history.md](revisions-and-history.md)); another member's personal items appear only in that member's own review.

## Printing

Annotations print when the export includes their layer and `includeAnnotations` is true (the default). Your personal layer prints only when you list `personal` in `layers`, which makes the export private to you. Nobody can print another member's personal layer.

Not possible: freehand ink. There is no stroke or path type; use `line`, `arrow`, `rect`, `ellipse`, `highlight`, `note` and `stamp`.

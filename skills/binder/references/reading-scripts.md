# Reading scripts

How to find your way through a document: pages, words, positions, search, and what a scanned script gives you.
Derived from `apps/api/src/mcp/tools/pages.ts`, `search.ts`, `words.ts`, `apps/api/src/services/pages.ts`, `search.ts`, `packages/core/src/search/*`, `anchors/*` and `apps/api/src/processing/documentJob.ts`.

Read this when you need to locate a moment in the script, understand a coordinate, or decide whether a document can be marked up by text at all.

## Start from the version id

Tools that read pages take a **document version id**, not a document id. Get it from `list_documents` (`currentVersionId` on the document) or `get_document` (`version.id`, plus the page count and per-page sizes). Only read the current version unless the user asks about an older one.

```
list_shows → showId
list_documents {showId} → documents[].currentVersionId, versions[].status
get_document {documentId} → version.pages[] (index, width, height, status)
get_page {versionId, index} / search_script {versionId, query}
```

A version must be `ready`. `queued` or `processing` pages have no words (`words: []`); poll `get_document` until the version is ready.

## Pages

`get_page` returns three things:

1. A text block: a header line (`Page 0 of version …: 595.28 x 841.89 pt, status ready, 197 words.`) and the page text, one line per text line in reading order. This is what to read.
2. An `image/jpeg` block (default on, at most 1600 px on the long side). Look at it when layout matters: a stage direction in italics, a song title, a hand-drawn mark on a scan. Pass `includeImage: false` to save tokens, or `maxPx: 400` for a thumbnail.
3. `structuredContent` with `width`, `height`, `rotation`, `status`, `ocrApplied`, `text`, `words` and `lines`.

`words[i]` is `[text, x, y, w, h]`: the word and its box in PDF points, rounded to 0.1. `lines` lists word indices per line, in reading order. Index `i` is the **word index** that anchors, highlights and search hits refer to on that page.

```json
"words":[["THE",50,778.6,22,10.2],["PIRATES",75.1,778.6,47.1,10.2],["OF",125.2,778.6,15.3,10.2],["PENZANCE",143.5,778.6,59.9,10.2],["OR",56.1,763.2,16.5,10.2]],
"lines":[[0,1,2,3],[4],[5,6,7,8]]
```

Budget: a 200-word page is about 9 KB of JSON (roughly 2,500 tokens) plus the image. For a long script, search first and read only the pages you need.

The same data is served as resources for clients that prefer reading: `binder://shows/{showId}/versions/{versionId}/pages/{index}/words` and `…/image`.

## The coordinate system

- Units are PDF points (1/72 inch). A4 is 595.28 × 841.89, Letter 612 × 792.
- The origin is the **bottom left** of the displayed page, after the PDF's `/Rotate`. `x` grows to the right, `y` grows **upward**. The top line of a page has the largest `y`.
- A word box's `y` is its bottom edge; its vertical centre is `y + h / 2`. A cue placed by text sits at `x` = the first word's left edge and `y` = the mean centre of its line.
- Reading order is page ascending, then `y` descending, then `x` ascending. "Before" in the script means a lower page index, or the same page and a higher `y`.
- The page frame is the visible box: a PDF whose crop box starts at (50, 50) still reads from (0, 0) here. Never compute coordinates from the image pixels; use `words`.

## Search

`search_script {versionId, query, limit?}` finds a phrase on one line of text, in page then reading order. Matching lowercases, strips diacritics and edge punctuation, and keeps inner apostrophes and hyphens: `fred'ric's` matches, `to-day` does not match `today`, and a phrase broken across two lines is not found. Each hit gives `pageIndex`, `lineIndex`, `wordStart`, `wordEnd` and the first word's `box`, plus a `snippet` with four words of context either side.

```json
{"hits":[{"lineIndex":22,"wordStart":138,"wordEnd":138,"pageIndex":0,"snippet":"curtain rises groups of pirates are discovered - some","box":{"x":167.381,"y":191.283,"w":33.011,"h":10.175}}]}
```

Use search to:

- find a line the user quoted ("where does the Pirate King enter?" → search `PIRATE KING, who enters`);
- count occurrences before placing a cue, so you can tell the user which one you mean;
- get `wordStart`/`wordEnd` for a `highlight` annotation;
- jump to a page, then `get_page` it to read the surrounding lines.

Default 50 hits, at most 200. An empty result means the words are not on one printed line in that form: a quote that wraps (`As the` at the end of one line, `curtain rises` on the next) returns nothing. Try fewer words, the distinctive ones, or read the page with `get_page` and see where the line breaks fall. `place_cue_at_text` does match across a line break, but anchors on the first word's line.

## Finding a described moment

When the user describes a moment instead of quoting it ("the blackout after the sherry chorus"):

1. Search for the proper nouns and distinctive words (`pirate sherry`, `OPENING CHORUS`).
2. Read the hit page with `get_page` and pick the exact line: the last line of the chorus, the stage direction after it.
3. Quote that line back to the user with its 1-based page number (`pageIndex + 1`) before writing anything.
4. Place with `place_cue_at_text` using the words as the page shows them. See [placing-cues.md](placing-cues.md).

## Text anchors versus positional anchors

A **text anchor** binds a mark to words: `anchor.text = {quote, wordStart, wordEnd}`. `place_cue_at_text` and `highlight` annotations make them. When a new script version arrives, the quote is searched for in the new text and the mark follows its line, even if the page changed. This is why you anchor to words, not coordinates: a position means nothing on a re-paginated script.

A **positional anchor** is `{pageIndex, x, y}` with no `text`. `create_cue` and `update_cue` with an `anchor`, and every shape, note and stamp, make them. On a revision they keep page and position (status `approximate` when page counts match, `unresolved` otherwise) and land in the review list. Use them for marks that are about a place on the page rather than a line (a note in the margin, a box around a stage picture), and for scans without text.

`update_cue` with a coordinate `anchor` replaces the whole anchor and **drops the trigger words**. To move a cue to a different line and keep it text-bound, delete it and place it again by quote, carrying over `number`, `label`, `type` and `notes` (and re-applying a custom `colour` with `update_cue`, since `place_cue_at_text` has none); the cue gets a new id and its history starts afresh. Or accept that it becomes positional.

## Scanned scripts

Processing turns every upload into a searchable PDF and a word layer per page:

- A PDF with real text is read as is (`ocrApplied: false`).
- A scan with `ocrMode: "auto"` goes through OCR (`ocrApplied: true` on recognised pages). OCR text has errors: quote short, distinctive runs, and check the page image when a quote is not found.
- A scan with `ocrMode: "never"` becomes `ready` with **no words**: `search_script` finds nothing and `place_cue_at_text` fails with `not_found`. Mark it up by position: read the page image, estimate the `y` of the line from the page height (the image's `height` maps linearly to `height` in points), and use `create_cue` with an `anchor`. Say in the cue's `notes` which line it is for.

A text-anchored document (`snapToText` true: the default for `libretto` and `other`) that failed with `no_text` (fewer than 20 text characters in total after OCR) or `low_resolution` (median scan resolution under 150 dpi) has nothing to read; scores and blocking documents are exempt from that check and simply come up with empty pages. For the failures, the message in `failureMessage` tells the user to upload a clearer scan, or to remove the upload and upload again as a document with text recognition set to `never` and mark it by position. Retrying cannot fix either. Full taxonomy in [documents-and-processing.md](documents-and-processing.md).

## What a page cannot tell you

- Character names, song titles and stage directions are plain words; nothing tags them. Recognise them from capitalisation, parentheses and the image.
- Line numbers printed in a margin are words too, and can pollute a quote. Quote the dialogue, not the margin.
- Page numbers in the footer are usually the first or last word of the page. `pageIndex` is zero-based and independent of what is printed.

# Public fixtures

`pirates.txt` is the libretto of "The Pirates of Penzance" by W. S. Gilbert, sliced from
Project Gutenberg ebook 808, "The Complete Plays of Gilbert and Sullivan"
(https://www.gutenberg.org/cache/epub/808/pg808.txt). It runs from the play's title heading to the
start of the next play, with the Project Gutenberg header, footer and trademark text removed.

The text is in the public domain in the United States. The Project Gutenberg licence permits
redistribution without the header and trademark.

`pnpm fixtures` generates, into the gitignored `generated/` directory:

- `pirates-libretto.pdf`: text PDF (A4, 11 pt, 48 lines per page).
- `pirates-scan.pdf`: first 8 pages rasterised at 150 dpi, image only (for OCR tests).
- `mixed.pdf`: A4 portrait text, an A4 page with `/Rotate 90`, a Letter page, and a rasterised page.
- `offset.pdf`: one A4 page whose media box and crop box start at (50, 50), with `OFFSET` at the visible top-left.

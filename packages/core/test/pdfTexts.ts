import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib'

const WIN_ANSI = new TextDecoder('windows-1252')

/** The page's content stream text, whether it is one stream or several and however each is filtered. */
function contentOf(doc: PDFDocument, contents: unknown): string {
  const chunks: string[] = []
  const add = (obj: unknown) => {
    const resolved = obj instanceof PDFRef ? doc.context.lookup(obj) : obj
    if (resolved instanceof PDFArray) {
      for (let i = 0; i < resolved.size(); i++) add(resolved.get(i))
    } else if (resolved instanceof PDFRawStream) {
      chunks.push(Buffer.from(decodePDFRawStream(resolved).decode()).toString('latin1'))
    } else if (
      resolved &&
      typeof (resolved as { getContents?: unknown }).getContents === 'function'
    ) {
      chunks.push(
        Buffer.from((resolved as { getContents(): Uint8Array }).getContents()).toString('latin1'),
      )
    }
  }
  add(contents)
  return chunks.join('\n')
}

/**
 * The strings a PDF draws, page by page, in drawing order (the operands of `Tj`). Pages drawn with
 * the standard fonts hold WinAnsi bytes in a hex string; this reads them back as text. A test
 * helper that needs no poppler, so the layout tests run everywhere.
 */
export async function pdfTexts(bytes: Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((page) => {
    const stream = contentOf(doc, page.node.get(PDFName.of('Contents')))
    const out: string[] = []
    for (const m of stream.matchAll(/<([0-9A-Fa-f\s]*)>\s*Tj/g)) {
      const hex = (m[1] as string).replace(/\s+/g, '')
      out.push(WIN_ANSI.decode(Buffer.from(hex, 'hex')))
    }
    return out
  })
}

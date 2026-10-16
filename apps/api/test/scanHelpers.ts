import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

/**
 * A one-page, image-only PDF of a blank white scan at `ppi` pixels per inch, written by hand so the
 * resolution is exact and no tool has to be on the PATH. Letter sized (612 x 792 pt); the page
 * draws its single image across the whole sheet, so `pdfimages -list` reports `ppi` for both axes.
 * Blank means there is no text for OCR to find, whatever the resolution.
 */
export function writeBlankScanPdf(path: string, ppi: number): void {
  const width = Math.round((612 / 72) * ppi)
  const height = Math.round((792 / 72) * ppi)
  const pixels = deflateSync(Buffer.alloc(width * height, 0xff))
  const parts: Buffer[] = []
  const offsets: number[] = []
  let length = 0
  const add = (chunk: Buffer | string) => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk
    parts.push(buf)
    length += buf.length
  }
  const object = (n: number, body: Buffer | string, stream?: Buffer) => {
    offsets[n] = length
    add(`${n} 0 obj\n`)
    add(body)
    if (stream) {
      add('\nstream\n')
      add(stream)
      add('\nendstream')
    }
    add('\nendobj\n')
  }
  add('%PDF-1.4\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(
    3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>',
  )
  const content = Buffer.from('q 612 0 0 792 0 0 cm /Im0 Do Q', 'latin1')
  object(4, `<< /Length ${content.length} >>`, content)
  object(
    5,
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>`,
    pixels,
  )
  const xref = length
  add(`xref\n0 6\n0000000000 65535 f \n`)
  for (let n = 1; n <= 5; n++) add(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  writeFileSync(path, Buffer.concat(parts))
}

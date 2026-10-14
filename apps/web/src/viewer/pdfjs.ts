import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Where PDF.js finds its data files: CMaps for non-embedded CJK fonts, the standard 14 fonts, ICC
 * profiles, and the wasm decoders (JPEG 2000, JBIG2) that scans use. vite.config.ts serves them
 * from pdfjs-dist in dev and copies them into the build.
 */
const assets = `${import.meta.env.BASE_URL}pdfjs/`
const assetOptions = {
  cMapUrl: `${assets}cmaps/`,
  standardFontDataUrl: `${assets}standard_fonts/`,
  iccUrl: `${assets}iccs/`,
  wasmUrl: `${assets}wasm/`,
}

/** Opens a PDF from bytes. PDF.js transfers `data` to its worker, which detaches the buffer. */
export function openPdf(data: Uint8Array) {
  return getDocument({ data, ...assetOptions })
}

export type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
export { RenderingCancelledException } from 'pdfjs-dist'

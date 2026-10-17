import { copyFile, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { OcrMode } from '@binder/shared'
import { firstLine, runTool, ToolError } from './exec'
import { contentSyntaxErrors } from './poppler'

export const OCRMYPDF_TIMEOUT_MS = 30 * 60 * 1000

/** OCRmyPDF's exit code for an encrypted input (EncryptedPdfError). */
const EXIT_ENCRYPTED = 8
/** qpdf's exit code for "finished with warnings"; the output is still written. */
const QPDF_WARNINGS = 3

const OCR_ARGS = ['--output-type', 'pdf', '--optimize', '0', '-l', 'eng', '--jobs', '2']

export interface OcrResult {
  ocrApplied: boolean
  /** OCRmyPDF's exit code; null when it was not run, could not start, or was killed. */
  exitCode: number | null
  stderr: string
  /** Set (true) only when OCRmyPDF ran past its timeout and was killed. */
  timedOut?: true
  /** The timeout it ran past; set with `timedOut`. */
  timeoutMs?: number
}

/**
 * Writes the searchable PDF to `output`. Mode `auto` runs OCRmyPDF with `--redo-ocr`, which keeps
 * existing vector text and OCRs only image regions (spec 5.1). Mode `never`, and any OCRmyPDF
 * failure (2 invalid input, 6 already has text, 7 child process error, 15 other, 8 encrypted when
 * the retry below cannot help, or a failure to start), writes a plain copy of the input instead.
 * An aborted run (`signal`) is not a failure to copy past: the ToolError is rethrown and nothing
 * is written. `timeoutMs` is the budget for the whole call, retries included.
 *
 * Two retries cover what older OCRmyPDF releases get wrong (Debian 12 ships 14.0, Ubuntu 24.04
 * 15.2; both are production-grade toolchains for us):
 * - An owner-restricted PDF (opens without a password, forbids copying or editing) is refused with
 *   exit 8 by those releases. It is decrypted with qpdf, which needs no password for it, and OCR
 *   runs on that copy, so the searchable PDF is unencrypted; the original upload is kept as it was.
 * - `--redo-ocr` re-serialises every page's content stream, and those releases write a tiny real
 *   (the 6.1e-17 in the matrix of quarter-turned text, say) in exponent form, which is not PDF
 *   syntax: poppler cannot read the text after it. When the output has more content-stream syntax errors than the
 *   input, the run is repeated with `--skip-text`, which leaves pages that have text untouched
 *   and still OCRs the pages that are only images.
 */
export async function runOcrmypdf(
  input: string,
  output: string,
  opts: { mode: OcrMode; signal?: AbortSignal; timeoutMs?: number },
): Promise<OcrResult> {
  if (opts.mode === 'never') {
    await copyFile(input, output)
    return { ocrApplied: false, exitCode: null, stderr: '' }
  }
  const timeoutMs = opts.timeoutMs ?? OCRMYPDF_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const ocr = (flag: '--redo-ocr' | '--skip-text', from: string) =>
    runTool('ocrmypdf', [flag, ...OCR_ARGS, from, output], {
      timeoutMs: Math.max(1, deadline - Date.now()),
      signal: opts.signal,
    })
  const decrypted = join(dirname(output), `${basename(output)}.decrypted.pdf`)
  try {
    let source = input
    let run: { stderr: string }
    try {
      run = await ocr('--redo-ocr', input)
    } catch (err) {
      if (!(err instanceof ToolError) || err.exitCode !== EXIT_ENCRYPTED) throw err
      // Report OCRmyPDF's refusal, not qpdf's, when the file cannot be decrypted without a password.
      if (!(await decryptCopy(input, decrypted, opts.signal, deadline))) throw err
      source = decrypted
      run = await ocr('--redo-ocr', source)
    }
    let stderr = run.stderr
    if (await damagedContentStreams(source, output)) {
      console.warn('OCRmyPDF --redo-ocr damaged the page text; repeating with --skip-text')
      stderr = (await ocr('--skip-text', source)).stderr
    }
    return { ocrApplied: true, exitCode: 0, stderr }
  } catch (err) {
    if (!(err instanceof ToolError) || err.aborted) throw err
    await copyFile(input, output)
    return {
      ocrApplied: false,
      exitCode: err.exitCode,
      stderr: err.stderr,
      ...(err.timedOut ? { timedOut: true as const, timeoutMs } : {}),
    }
  } finally {
    await rm(decrypted, { force: true })
  }
}

/** Writes an unencrypted copy of `input` to `to`; false when qpdf could not (a real password). */
async function decryptCopy(
  input: string,
  to: string,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<boolean> {
  try {
    await runTool('qpdf', ['--decrypt', input, to], {
      timeoutMs: Math.max(1, deadline - Date.now()),
      signal,
    })
    return true
  } catch (err) {
    if (!(err instanceof ToolError) || err.aborted) throw err
    return err.exitCode === QPDF_WARNINGS
  }
}

/**
 * True when OCR left the PDF with more content-stream syntax errors (poppler's) than it started
 * with. A PDF that cannot be checked counts as undamaged: the pipeline reads it next and decides.
 */
async function damagedContentStreams(source: string, output: string): Promise<boolean> {
  const after = await contentSyntaxErrors(output).catch(() => 0)
  if (after === 0) return false
  return after > (await contentSyntaxErrors(source).catch(() => 0))
}

/**
 * The one-line summary stored in the version's `error` when OCR fell back to a copy. A timeout is a
 * constant sentence: the tool's own first stderr line (a start-up banner, say) would hide it.
 */
export function describeOcrFailure(result: OcrResult): string {
  if (result.timedOut) {
    return result.timeoutMs === undefined
      ? 'ocrmypdf timed out'
      : `ocrmypdf timed out after ${result.timeoutMs / 1000}s`
  }
  return `ocrmypdf exit ${result.exitCode ?? 'none'}: ${firstLine(result.stderr)}`
}

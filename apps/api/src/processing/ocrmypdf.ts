import { copyFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { OcrMode } from '@binder/shared'
import { firstLine, runTool, ToolError } from './exec'
import { contentSyntaxErrors, countTextChars } from './poppler'

export const OCRMYPDF_TIMEOUT_MS = 30 * 60 * 1000

/** OCRmyPDF's exit code for an encrypted input (EncryptedPdfError). */
const EXIT_ENCRYPTED = 8
/** qpdf's exit code for "finished with warnings"; the output is still written. */
const QPDF_WARNINGS = 3
/** Time allowed to qpdf for a check or a decrypt, which are quick. */
const QPDF_TIMEOUT_MS = 2 * 60 * 1000

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
  /**
   * Set when OCR ran but a fallback came into play that explains why some page lacks OCR: the
   * `--skip-text` retry described below was used, or was tried and discarded or failed.
   */
  note?: string
}

/**
 * Writes the searchable PDF to `output`, and the searchable PDF is never encrypted: an owner-only
 * restricted upload (opens without a password, forbids copying or editing) gets an unrestricted
 * working copy on every path out of here, because pdf-lib refuses to load an encrypted file and the
 * marked-script export is built from it. The original upload is kept as it was. A file that needs
 * a real password cannot be decrypted and stays as it is, for the caller's pdfinfo to reject.
 *
 * Mode `auto` runs OCRmyPDF with `--redo-ocr`, which keeps existing vector text and OCRs only image
 * regions (spec 5.1). Mode `never`, and any OCRmyPDF failure (2 invalid input, 6 already has text,
 * 7 child process error, 15 other, 8 encrypted when the retry below cannot help, or a failure to
 * start), writes a plain copy of the input (its decrypted copy, when there is one) instead. An
 * aborted run (`signal`) is not a failure to copy past: the ToolError is rethrown and nothing is
 * written. `timeoutMs` is the budget for the whole call, retries included.
 *
 * Two retries cover what older OCRmyPDF releases get wrong (Debian 12 ships 14.0, Ubuntu 24.04
 * 15.2; both are production-grade toolchains for us):
 * - Those releases refuse any encrypted input with exit 8. It is decrypted with qpdf, which needs
 *   no password for an owner-only file, and OCR runs on that copy.
 * - `--redo-ocr` re-serialises every page's content stream, and those releases write a tiny real
 *   (the 6.1e-17 in the matrix of quarter-turned text, say) in exponent form, which is not PDF
 *   syntax: poppler cannot read the text after it. When the output has more content-stream syntax
 *   errors than the input, or less text than it, `--skip-text` is run into a scratch file. It
 *   leaves pages that have text untouched and OCRs only pages that are all image, so it replaces
 *   the `--redo-ocr` output only when it found at least as much text (a page that is a scan under
 *   a vector-text overlay would lose its body OCR otherwise). If it fails, times out or finds
 *   less, the `--redo-ocr` output stays, and `note` says which happened.
 */
export async function runOcrmypdf(
  input: string,
  output: string,
  opts: { mode: OcrMode; signal?: AbortSignal; timeoutMs?: number },
): Promise<OcrResult> {
  const { signal } = opts
  if (opts.mode === 'never') {
    await copyFile(input, output)
    await unrestrict(output, signal)
    return { ocrApplied: false, exitCode: null, stderr: '' }
  }
  const timeoutMs = opts.timeoutMs ?? OCRMYPDF_TIMEOUT_MS
  const started = performance.now()
  const left = () => Math.max(1, timeoutMs - (performance.now() - started))
  const ocr = (flag: '--redo-ocr' | '--skip-text', from: string, to: string) =>
    runTool('ocrmypdf', [flag, ...OCR_ARGS, from, to], { timeoutMs: left(), signal })
  const decrypted = join(dirname(output), `${basename(output)}.decrypted.pdf`)
  // What the fallback copies and the retries compare against: the upload, or its decrypted copy.
  let source = input
  try {
    let run: { stderr: string }
    try {
      run = await ocr('--redo-ocr', input, output)
    } catch (err) {
      if (!(err instanceof ToolError) || err.exitCode !== EXIT_ENCRYPTED) throw err
      // Report OCRmyPDF's refusal, not qpdf's, when the file cannot be decrypted without a password.
      if (!(await decryptCopy(input, decrypted, signal, left))) throw err
      source = decrypted
      run = await ocr('--redo-ocr', source, output)
    }
    const note = (await damaged(source, output, signal, left))
      ? await skipTextRetry(source, output, ocr, signal, left)
      : undefined
    await unrestrict(output, signal)
    return { ocrApplied: true, exitCode: 0, stderr: run.stderr, ...(note ? { note } : {}) }
  } catch (err) {
    if (!(err instanceof ToolError) || err.aborted) throw err
    await copyFile(source, output)
    await unrestrict(output, signal)
    return {
      ocrApplied: false,
      exitCode: err.exitCode,
      stderr: err.stderr,
      ...(err.timedOut ? { timedOut: true as const, timeoutMs } : {}),
    }
  } finally {
    await rm(decrypted, { force: true }).catch(() => {})
  }
}

/** Writes an unencrypted copy of `input` to `to`; false when qpdf could not (a real password). */
async function decryptCopy(
  input: string,
  to: string,
  signal: AbortSignal | undefined,
  left: () => number,
): Promise<boolean> {
  try {
    await runTool('qpdf', ['--decrypt', input, to], {
      timeoutMs: Math.min(QPDF_TIMEOUT_MS, left()),
      signal,
    })
    return true
  } catch (err) {
    if (!(err instanceof ToolError) || err.aborted) throw err
    return err.exitCode === QPDF_WARNINGS
  }
}

/**
 * Replaces `pdf` with its decrypted copy when it is encrypted (`qpdf --is-encrypted` exits 0).
 * Left as it is when qpdf cannot tell or cannot decrypt it (a real password): the pipeline reads
 * it next and fails the version as password-protected.
 */
async function unrestrict(pdf: string, signal: AbortSignal | undefined): Promise<void> {
  const qpdf = (args: string[]) => runTool('qpdf', args, { timeoutMs: QPDF_TIMEOUT_MS, signal })
  try {
    await qpdf(['--is-encrypted', pdf])
  } catch (err) {
    if (err instanceof ToolError && err.aborted) throw err
    return // exit 2: not encrypted (or not a PDF qpdf can read)
  }
  try {
    await qpdf(['--decrypt', '--replace-input', pdf])
  } catch (err) {
    if (err instanceof ToolError && err.aborted) throw err
    if (!(err instanceof ToolError) || err.exitCode !== QPDF_WARNINGS) return
  }
}

/**
 * True when OCR left the PDF worse than it was: more content-stream syntax errors (poppler's) than
 * the source, or less text than it (OCR only ever adds text). A PDF that cannot be checked counts
 * as undamaged: the pipeline reads it next and decides.
 */
async function damaged(
  source: string,
  output: string,
  signal: AbortSignal | undefined,
  left: () => number,
): Promise<boolean> {
  const o = () => ({ timeoutMs: left(), signal })
  try {
    const after = await contentSyntaxErrors(output, o())
    if (after > 0 && after > (await contentSyntaxErrors(source, o()))) return true
    return (await countTextChars(output, o())) < (await countTextChars(source, o()))
  } catch (err) {
    if (err instanceof ToolError && err.aborted) throw err
    return false
  }
}

/**
 * Repeats the run with `--skip-text` into a scratch file beside `output`, and moves it over
 * `output` only if it found at least as much text as the `--redo-ocr` output there. Never throws
 * past an abort: whatever goes wrong, the `--redo-ocr` output stays. Returns the note for the
 * version.
 */
async function skipTextRetry(
  source: string,
  output: string,
  ocr: (flag: '--skip-text', from: string, to: string) => Promise<unknown>,
  signal: AbortSignal | undefined,
  left: () => number,
): Promise<string> {
  const scratch = `${output}.skip.pdf`
  const why = '--redo-ocr damaged the text of some pages'
  try {
    await ocr('--skip-text', source, scratch)
    const o = { timeoutMs: left(), signal }
    const [redo, skip] = [await countTextChars(output, o), await countTextChars(scratch, o)]
    if (skip < redo) {
      return `${why}; the --skip-text retry found less text (${skip} characters, not ${redo}), so the --redo-ocr output was kept`
    }
    await rename(scratch, output)
    return `${why}; OCR was repeated with --skip-text, so pages that already had text were not re-OCRd`
  } catch (err) {
    if (err instanceof ToolError && err.aborted) throw err
    const what =
      err instanceof ToolError
        ? err.timedOut
          ? 'timed out'
          : `exit ${err.exitCode ?? 'none'}: ${firstLine(err.stderr)}`
        : String(err)
    return `${why}; the --skip-text retry failed (${what}), so the --redo-ocr output was kept`
  } finally {
    await rm(scratch, { force: true }).catch(() => {})
  }
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

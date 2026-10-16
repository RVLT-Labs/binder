import { copyFile } from 'node:fs/promises'
import type { OcrMode } from '@binder/shared'
import { firstLine, runTool, ToolError } from './exec'

export const OCRMYPDF_TIMEOUT_MS = 30 * 60 * 1000

export interface OcrResult {
  ocrApplied: boolean
  /** OCRmyPDF's exit code; null when it was not run, could not start, or was killed. */
  exitCode: number | null
  stderr: string
  /** Set (true) only when OCRmyPDF ran past its timeout and was killed. */
  timedOut?: true
}

/**
 * Writes the searchable PDF to `output`. Mode `auto` runs OCRmyPDF with `--redo-ocr`, which keeps
 * existing vector text and OCRs only image regions (spec 5.1). Mode `never`, and any OCRmyPDF
 * failure (2 invalid input, 6 already has text, 7 child process error, 8 encrypted, 15 other, or a
 * failure to start), writes a plain copy of the input instead. An aborted run (`signal`) is not a
 * failure to copy past: the ToolError is rethrown and nothing is written.
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
  try {
    const { stderr } = await runTool(
      'ocrmypdf',
      [
        '--redo-ocr',
        '--output-type',
        'pdf',
        '--optimize',
        '0',
        '-l',
        'eng',
        '--jobs',
        '2',
        input,
        output,
      ],
      { timeoutMs: opts.timeoutMs ?? OCRMYPDF_TIMEOUT_MS, signal: opts.signal },
    )
    return { ocrApplied: true, exitCode: 0, stderr }
  } catch (err) {
    if (!(err instanceof ToolError) || err.aborted) throw err
    await copyFile(input, output)
    return {
      ocrApplied: false,
      exitCode: err.exitCode,
      stderr: err.stderr,
      ...(err.timedOut ? { timedOut: true as const } : {}),
    }
  }
}

/** The one-line summary stored in the version's `error` when OCR fell back to a copy. */
export function describeOcrFailure(result: OcrResult): string {
  if (result.timedOut) return `ocrmypdf ${firstLine(result.stderr) || 'timed out'}`
  return `ocrmypdf exit ${result.exitCode ?? 'none'}: ${firstLine(result.stderr)}`
}
